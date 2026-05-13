"""
QClaw Clipper — Automated viral clip extraction microservice.

Takes podcast video files, uses Claude to select viral segments,
cuts them with FFmpeg, burns captions, and uploads to R2.
"""

import os
import re
import json
import uuid
import glob
import subprocess
import threading
import logging
from datetime import datetime, timezone
from typing import Any, Optional, List

import httpx
import anthropic
import boto3
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, validator

# ---------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------

def load_env(path: str):
    """Parse a .env file into os.environ (no dotenv dependency)."""
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, _, value = line.partition("=")
                    os.environ.setdefault(key.strip(), value.strip())
    except FileNotFoundError:
        pass

load_env("/root/.quantumclaw/.env")

R2_ACCOUNT_ID = os.environ.get("R2_ACCOUNT_ID", "")
R2_ACCESS_KEY_ID = os.environ.get("R2_ACCESS_KEY_ID", "")
R2_SECRET_ACCESS_KEY = os.environ.get("R2_SECRET_ACCESS_KEY", "")
R2_BUCKET_NAME = os.environ.get("R2_BUCKET_NAME", "")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://fdabygmromuqtysitodp.supabase.co")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
if not SUPABASE_SERVICE_ROLE_KEY:
    raise RuntimeError(
        "SUPABASE_SERVICE_ROLE_KEY not set — clipper-worker "
        "requires service_role auth as of ζ.1 (2026-05-07). "
        "See QCLAW_BUILD_LOG.md."
    )

R2_PUBLIC_BASE = "https://pub-70c436931e9e4611a135e7405c596611.r2.dev"

if not ANTHROPIC_API_KEY:
    raise RuntimeError("ANTHROPIC_API_KEY not set")

# ---------------------------------------------------------------------------
# Clients
# ---------------------------------------------------------------------------

claude = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

s3 = boto3.client(
    "s3",
    endpoint_url=f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com",
    aws_access_key_id=R2_ACCESS_KEY_ID,
    aws_secret_access_key=R2_SECRET_ACCESS_KEY,
    region_name="auto",
)

log = logging.getLogger("clipper")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

# ---------------------------------------------------------------------------
# Supabase helpers
# ---------------------------------------------------------------------------

SUPA_HEADERS = {
    "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
    "apikey": SUPABASE_SERVICE_ROLE_KEY,
    "Content-Type": "application/json",
}

def supa_url(path: str = "") -> str:
    return f"{SUPABASE_URL}/rest/v1/clip_jobs{path}"

def db_insert(record: dict) -> dict:
    headers = {**SUPA_HEADERS, "Prefer": "return=representation"}
    r = httpx.post(supa_url(), headers=headers, json=record, timeout=30)
    r.raise_for_status()
    return r.json()[0]

def db_update(job_id: str, patch: dict) -> dict:
    patch["updated_at"] = _now()
    headers = {**SUPA_HEADERS, "Prefer": "return=representation"}
    r = httpx.patch(supa_url(f"?id=eq.{job_id}"), headers=headers, json=patch, timeout=30)
    r.raise_for_status()
    rows = r.json()
    return rows[0] if rows else patch

def db_get(job_id: str) -> Optional[dict]:
    r = httpx.get(supa_url(f"?id=eq.{job_id}"), headers=SUPA_HEADERS, timeout=30)
    r.raise_for_status()
    rows = r.json()
    return rows[0] if rows else None

# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(title="QClaw Clipper", version="1.0.0")


class ClipRequest(BaseModel):
    video_url: Optional[str] = None
    r2_file_key: str
    episode_title: str
    transcript: List[dict]   # [{text, start, end, confidence}, ...]
    num_clips: int = 5
    caption_style: Optional[Any] = None

    @validator("caption_style", pre=True)
    def parse_caption_style(cls, v):
        if isinstance(v, str):
            try:
                return json.loads(v)
            except (json.JSONDecodeError, TypeError):
                return v
        return v


class ClipResponse(BaseModel):
    job_id: str
    status: str


@app.get("/health")
def health():
    return {"status": "ok", "service": "clipper"}


@app.post("/clip", response_model=ClipResponse)
def create_clip_job(req: ClipRequest):
    job_id = str(uuid.uuid4())

    db_insert({
        "id": job_id,
        "status": "queued",
        "episode_title": req.episode_title,
        "r2_file_key": req.r2_file_key,
        "video_url": req.video_url or f"{R2_PUBLIC_BASE}/{req.r2_file_key}",
        "transcript": req.transcript,
        "num_clips": req.num_clips,
    })

    # Launch background worker
    t = threading.Thread(target=run_clip_job, args=(job_id, req), daemon=True)
    t.start()

    return ClipResponse(job_id=job_id, status="queued")


@app.get("/clip/{job_id}")
def get_clip_job(job_id: str):
    record = db_get(job_id)
    if not record:
        raise HTTPException(status_code=404, detail="Job not found")
    return record


# ---------------------------------------------------------------------------
# Face detection & smart crop (Phase 2)
# ---------------------------------------------------------------------------

def detect_face_position(video_path: str):
    """
    Sample frames from video, detect faces, return average face
    center as (x_ratio, y_ratio) where values are 0.0-1.0
    relative to frame dimensions.
    Returns None if no face detected.
    """
    import cv2

    model_dir = os.path.join(os.path.dirname(__file__), 'models')
    prototxt = os.path.join(model_dir, 'deploy.prototxt')
    caffemodel = os.path.join(model_dir, 'res10_300x300_ssd_iter_140000.caffemodel')

    if not os.path.exists(prototxt) or not os.path.exists(caffemodel):
        log.warning("Face detection model files not found, skipping")
        return None

    net = cv2.dnn.readNetFromCaffe(prototxt, caffemodel)

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        return None

    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    frame_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    frame_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    # Sample 1 frame per second, max 10 frames
    sample_interval = max(1, int(fps))
    sample_frames = list(range(0, min(total_frames, sample_interval * 10), sample_interval))

    face_positions = []

    for frame_num in sample_frames:
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_num)
        ret, frame = cap.read()
        if not ret:
            continue

        blob = cv2.dnn.blobFromImage(
            cv2.resize(frame, (300, 300)), 1.0,
            (300, 300), (104.0, 177.0, 123.0)
        )
        net.setInput(blob)
        detections = net.forward()

        best_conf = 0.5
        best_face = None

        for i in range(detections.shape[2]):
            confidence = detections[0, 0, i, 2]
            if confidence > best_conf:
                best_conf = confidence
                box = detections[0, 0, i, 3:7] * [
                    frame_width, frame_height,
                    frame_width, frame_height
                ]
                x1, y1, x2, y2 = box.astype(int)
                best_face = (
                    (x1 + x2) / 2 / frame_width,
                    (y1 + y2) / 2 / frame_height
                )

        if best_face:
            face_positions.append(best_face)

    cap.release()
    del net

    if not face_positions:
        return None

    avg_x = sum(p[0] for p in face_positions) / len(face_positions)
    avg_y = sum(p[1] for p in face_positions) / len(face_positions)
    return (avg_x, avg_y)


def get_smart_crop_filter(video_path: str) -> str:
    """
    Returns FFmpeg crop filter for 9:16 using face position.
    Falls back to center crop if no face detected.
    Face placed at upper third (rule of thirds).
    """
    face_pos = detect_face_position(video_path)

    if face_pos is None:
        log.info("No face detected, using center crop")
        return "crop=ih*9/16:ih:(iw-ih*9/16)/2:0"

    face_x_ratio, face_y_ratio = face_pos
    log.info(f"Face detected at ({face_x_ratio:.2f}, {face_y_ratio:.2f}), applying smart crop")

    # Horizontal: center crop on face x position
    # Clamp to valid range so we don't go out of bounds.
    # Commas inside the FFmpeg expression MUST be backslash-escaped
    # because FFmpeg's filtergraph parser treats unescaped commas as
    # filter-chain separators (Bug 1, 2026-05-13).
    crop_x_expr = (
        f"max(0\\, min(iw-ih*9/16\\, "
        f"{face_x_ratio:.4f}*iw - ih*9/16/2))"
    )

    # Vertical: full height for 9:16, y=0
    return f"crop=ih*9/16:ih:{crop_x_expr}:0"


# ---------------------------------------------------------------------------
# Background clip job
# ---------------------------------------------------------------------------

def run_clip_job(job_id: str, req: ClipRequest):
    """Full clip pipeline — runs in a background thread."""
    try:
        db_update(job_id, {"status": "processing"})

        # Step 1 — Select segments with Claude
        log.info(f"[{job_id}] Step 1: Selecting segments with Claude")
        segments = select_segments(req.transcript, req.episode_title, req.num_clips)
        log.info(f"[{job_id}] Claude selected {len(segments)} segments")

        # Step 2 — Download source video from R2
        log.info(f"[{job_id}] Step 2: Downloading video from R2")
        input_path = f"/tmp/{job_id}_input.mp4"
        s3.download_file(R2_BUCKET_NAME, req.r2_file_key, input_path)

        # Probe video duration to cap segment times
        video_duration_ms = _get_video_duration_ms(input_path)
        log.info(f"[{job_id}] Video duration: {video_duration_ms}ms")

        clips_result = []

        for n, seg in enumerate(segments):
            start_ms = seg["start_ms"]
            end_ms = min(seg["end_ms"], video_duration_ms)
            if start_ms >= video_duration_ms:
                log.warning(f"[{job_id}] Clip {n} start ({start_ms}ms) beyond video duration, skipping")
                continue
            start_s = start_ms / 1000.0
            end_s = end_ms / 1000.0

            # Step 3 — Cut clip
            log.info(f"[{job_id}] Step 3: Cutting clip {n}")
            raw_clip = f"/tmp/{job_id}_clip_{n}.mp4"
            subprocess.run(
                [
                    "ffmpeg", "-y",
                    "-i", input_path,
                    "-ss", str(start_s),
                    "-to", str(end_s),
                    "-c", "copy",
                    raw_clip,
                ],
                check=True,
                capture_output=True,
            )

            # Step 3b — Smart crop to 9:16 vertical (face-aware)
            log.info(f"[{job_id}] Step 3b: Smart cropping clip {n} to 9:16")
            vertical_clip = f"/tmp/{job_id}_vertical_{n}.mp4"
            smart_crop = get_smart_crop_filter(raw_clip)
            crop_to_vertical(raw_clip, vertical_clip, smart_crop)

            # Step 4 — Generate SRT and burn captions
            log.info(f"[{job_id}] Step 4: Burning captions on clip {n}")
            srt_path = f"/tmp/{job_id}_clip_{n}.srt"
            captioned_path = f"/tmp/{job_id}_captioned_{n}.mp4"
            generate_srt(req.transcript, start_ms, end_ms, srt_path, req.caption_style)
            burn_captions(vertical_clip, srt_path, captioned_path)

            # Step 5 — Upload to R2
            log.info(f"[{job_id}] Step 5: Uploading clip {n} to R2")
            r2_key = f"clips/{job_id}/clip_{n}.mp4"
            s3.upload_file(
                captioned_path,
                R2_BUCKET_NAME,
                r2_key,
                ExtraArgs={"ContentType": "video/mp4"},
            )

            clips_result.append({
                "index": n,
                "hook_title": seg.get("hook_title", ""),
                "caption_text": seg.get("caption_text", ""),
                "virality_score": seg.get("virality_score", 0),
                "start_ms": start_ms,
                "end_ms": end_ms,
                "duration_s": round(end_s - start_s, 2),
                "r2_key": r2_key,
                "public_url": f"{R2_PUBLIC_BASE}/{r2_key}",
            })

        # Step 6 — Update job as complete
        log.info(f"[{job_id}] Step 6: Updating job — complete")
        db_update(job_id, {
            "status": "complete",
            "clips": clips_result,
        })

    except Exception as e:
        log.error(f"[{job_id}] Job failed: {e}")
        try:
            db_update(job_id, {
                "status": "error",
                "error_message": str(e),
            })
        except Exception:
            pass
    finally:
        cleanup(job_id)


# ---------------------------------------------------------------------------
# Step 1 — Claude segment selection
# ---------------------------------------------------------------------------

def select_segments(transcript: List[dict], episode_title: str, num_clips: int) -> list:
    """Ask Claude Haiku to pick the best viral segments."""

    # Build transcript text with timestamps
    lines = []
    for w in transcript:
        lines.append(f"[{w['start']}ms] {w['text']}")
    transcript_text = " ".join(lines)

    user_prompt = (
        f"Episode title: {episode_title}\n\n"
        f"Transcript (word-level timestamps in milliseconds):\n{transcript_text}\n\n"
        f"Select the {num_clips} best viral clip segments. Each clip should be 30–90 seconds long.\n"
        f"Return ONLY a JSON array (no other text) with this schema:\n"
        f'[{{"start_ms": int, "end_ms": int, "hook_title": "string", "caption_text": "string", "virality_score": 1-10}}]'
    )

    resp = claude.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=4096,
        system="You are an expert social media editor. Given a podcast transcript with word-level timestamps (milliseconds), select the best viral clip segments. Return only valid JSON.",
        messages=[{"role": "user", "content": user_prompt}],
    )

    raw = resp.content[0].text

    # Extract JSON from markdown code block if present
    m = re.search(r"```(?:json)?\s*([\s\S]*?)```", raw)
    if m:
        raw = m.group(1).strip()

    segments = json.loads(raw)

    if not isinstance(segments, list):
        raise ValueError("Claude did not return a JSON array")

    return segments


# ---------------------------------------------------------------------------
# Step 4 helpers — SRT generation & caption burning
# ---------------------------------------------------------------------------

def _ms_to_srt_ts(ms: int) -> str:
    """Convert milliseconds to SRT timestamp HH:MM:SS,mmm."""
    total_s, millis = divmod(ms, 1000)
    mins, secs = divmod(total_s, 60)
    hours, mins = divmod(mins, 60)
    return f"{int(hours):02d}:{int(mins):02d}:{int(secs):02d},{int(millis):03d}"


def generate_srt(
    transcript: List[dict],
    start_ms: int,
    end_ms: int,
    srt_path: str,
    caption_style=None,
):
    """Generate an SRT file from transcript words within the clip range."""

    # Filter words in range
    words = [w for w in transcript if w["end"] >= start_ms and w["start"] <= end_ms]
    if not words:
        # Write empty SRT
        with open(srt_path, "w") as f:
            pass
        return

    # Offset times so clip starts at 0
    offset = start_ms

    entries = []
    animation = caption_style.get("animation") if isinstance(caption_style, dict) else caption_style
    if animation == "word_by_word":
        for i, w in enumerate(words):
            entries.append({
                "index": i + 1,
                "start": max(0, w["start"] - offset),
                "end": w["end"] - offset,
                "text": w["text"],
            })
    else:
        # Group into ~5-word chunks
        chunk_size = 5
        for i in range(0, len(words), chunk_size):
            chunk = words[i : i + chunk_size]
            entries.append({
                "index": len(entries) + 1,
                "start": max(0, chunk[0]["start"] - offset),
                "end": chunk[-1]["end"] - offset,
                "text": " ".join(w["text"] for w in chunk),
            })

    with open(srt_path, "w") as f:
        for e in entries:
            f.write(f"{e['index']}\n")
            f.write(f"{_ms_to_srt_ts(e['start'])} --> {_ms_to_srt_ts(e['end'])}\n")
            f.write(f"{e['text']}\n\n")


def crop_to_vertical(input_path: str, output_path: str, crop_filter: str = None):
    """Crop video to 9:16 vertical aspect ratio using smart crop or centred fallback."""
    if crop_filter is None:
        crop_filter = "crop=min(iw\\,ih*9/16):min(ih\\,iw*16/9):(iw-min(iw\\,ih*9/16))/2:(ih-min(ih\\,iw*16/9))/2"
    subprocess.run(
        [
            "ffmpeg", "-y",
            "-threads", "1",
            "-i", input_path,
            "-vf", crop_filter,
            "-preset", "ultrafast",
            "-c:a", "aac", "-b:a", "128k", "-ac", "2",
            "-movflags", "+faststart",
            output_path,
        ],
        check=True,
        capture_output=True,
    )


def burn_captions(input_path: str, srt_path: str, output_path: str):
    """Burn SRT subtitles onto video using FFmpeg."""
    # Escape special chars in path for FFmpeg subtitle filter
    escaped_srt = srt_path.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")

    subprocess.run(
        [
            "ffmpeg", "-y",
            "-threads", "1",
            "-i", input_path,
            "-vf",
            f"subtitles={escaped_srt}:force_style='FontName=Montserrat Bold,FontSize=48,"
            f"PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,Outline=2,"
            f"Alignment=2,MarginV=180,MarginL=40,MarginR=40'",
            "-preset", "ultrafast",
            "-c:a", "copy",
            output_path,
        ],
        check=True,
        capture_output=True,
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_video_duration_ms(path: str) -> int:
    """Probe video duration in milliseconds using ffprobe."""
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", path],
            capture_output=True, text=True, check=True,
        )
        return int(float(result.stdout.strip()) * 1000)
    except Exception:
        return 999999999  # fallback: don't cap


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def cleanup(job_id: str):
    """Remove all temp files for this job."""
    for f in glob.glob(f"/tmp/{job_id}_*"):
        try:
            os.remove(f)
        except OSError:
            pass
