#!/usr/bin/env python3
"""Polymarket market scanner — finds gold/BTC markets via Gamma API."""

import requests
import json
import sys
from datetime import datetime

GAMMA_API = "https://gamma-api.polymarket.com/markets"
KEYWORDS = ["gold", "bitcoin", "btc", "xau"]

SUPABASE_URL = "https://fdabygmromuqtysitodp.supabase.co/rest/v1"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZkYWJ5Z21yb211cXR5c2l0b2RwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk2NjI2OTQsImV4cCI6MjA3NTIzODY5NH0.6JJMkPXBufpLxlisH1ig32Xm8YM3p0jcXRlBzx5x8Dk"


def fetch_markets():
    """Fetch active markets from Polymarket Gamma API."""
    markets = []
    offset = 0
    while True:
        resp = requests.get(GAMMA_API, params={
            "closed": "false",
            "limit": 100,
            "offset": offset,
        }, timeout=15)
        resp.raise_for_status()
        batch = resp.json()
        if not batch:
            break
        markets.extend(batch)
        if len(batch) < 100:
            break
        offset += 100
        if offset > 500:
            break
    return markets


def filter_markets(markets):
    """Filter for gold/BTC related markets."""
    filtered = []
    for m in markets:
        question = (m.get("question") or "").lower()
        description = (m.get("description") or "").lower()
        text = question + " " + description
        if any(kw in text for kw in KEYWORDS):
            # Extract yes price from outcomes
            yes_price = None
            outcomes = m.get("outcomePrices")
            if outcomes:
                try:
                    prices = json.loads(outcomes) if isinstance(outcomes, str) else outcomes
                    if prices:
                        yes_price = float(prices[0])
                except (json.JSONDecodeError, IndexError, TypeError):
                    pass

            filtered.append({
                "market_id": m.get("id") or m.get("conditionId", ""),
                "question": m.get("question", ""),
                "yes_price": yes_price,
                "end_date": m.get("endDate"),
                "volume": float(m.get("volume", 0) or 0),
                "condition_id": m.get("conditionId", ""),
                "slug": m.get("slug", ""),
            })
    return filtered


def save_to_supabase(markets):
    """Upsert markets to Supabase trading_markets table."""
    if not markets:
        return 0

    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates",
    }

    rows = []
    for m in markets:
        rows.append({
            "market_id": m["market_id"],
            "question": m["question"],
            "yes_price": m["yes_price"],
            "end_date": m["end_date"],
            "volume": m["volume"],
            "condition_id": m["condition_id"],
            "slug": m["slug"],
            "last_scanned_at": datetime.utcnow().isoformat(),
        })

    resp = requests.post(
        f"{SUPABASE_URL}/trading_markets",
        headers=headers,
        json=rows,
        timeout=15,
    )
    if resp.status_code >= 400:
        print(f"Supabase error: {resp.status_code} {resp.text}", file=sys.stderr)
    return len(rows)


def scan():
    """Run a full scan and return results."""
    markets = fetch_markets()
    filtered = filter_markets(markets)
    saved = save_to_supabase(filtered)
    return filtered, saved


if __name__ == "__main__":
    filtered, saved = scan()
    print(json.dumps({"markets": filtered, "saved": saved}, indent=2, default=str))
