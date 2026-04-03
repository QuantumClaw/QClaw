#!/usr/bin/env python3
"""Monte Carlo simulation worker for gold and BTC price prediction."""

from flask import Flask, request, jsonify
import yfinance as yf
import numpy as np
from scipy import stats
from datetime import datetime, timedelta
import math

app = Flask(__name__)

TICKERS = {
    "gold": "GC=F",
    "btc": "BTC-USD",
}
MACRO_TICKERS = {
    "dxy": "DX-Y.NYB",
    "tnx": "^TNX",
}

NUM_SIMULATIONS = 10_000
TRADING_DAYS_YEAR = 252


def wilson_interval(successes, total, z=1.96):
    """Wilson score interval for binomial proportion."""
    if total == 0:
        return 0.0, 0.0, 0.0
    p_hat = successes / total
    denom = 1 + z**2 / total
    centre = (p_hat + z**2 / (2 * total)) / denom
    spread = z * math.sqrt((p_hat * (1 - p_hat) + z**2 / (4 * total)) / total) / denom
    return round(centre, 4), round(max(0, centre - spread), 4), round(min(1, centre + spread), 4)


def fetch_macro():
    """Fetch macro factors: DXY and 10Y yield."""
    factors = {}
    try:
        for name, ticker in MACRO_TICKERS.items():
            data = yf.download(ticker, period="5d", progress=False, auto_adjust=True)
            if len(data) >= 2:
                current = float(data["Close"].iloc[-1])
                prev = float(data["Close"].iloc[-2])
                change_pct = (current - prev) / prev * 100
                factors[name] = {"current": round(current, 4), "change_pct": round(change_pct, 4)}
            else:
                factors[name] = {"current": None, "change_pct": 0}
    except Exception as e:
        factors["error"] = str(e)
    return factors


def run_simulation(asset, target, horizon_days=30):
    """Run Monte Carlo simulation for an asset."""
    ticker_symbol = TICKERS.get(asset)
    if not ticker_symbol:
        return None, f"Unknown asset: {asset}"

    # Fetch 90 days of historical data
    data = yf.download(ticker_symbol, period="90d", progress=False, auto_adjust=True)
    if len(data) < 10:
        return None, f"Insufficient data for {asset}"

    prices = data["Close"].values.flatten()
    current_price = float(prices[-1])

    # Calculate daily returns
    log_returns = np.diff(np.log(prices))
    mu = float(np.mean(log_returns))
    sigma = float(np.std(log_returns))

    dt = 1.0 / TRADING_DAYS_YEAR
    steps = horizon_days

    # Generate Monte Carlo paths using GBM
    np.random.seed(None)
    Z = np.random.standard_normal((NUM_SIMULATIONS, steps))
    drift = (mu - 0.5 * sigma**2) * dt
    diffusion = sigma * np.sqrt(dt) * Z

    # Build price paths
    log_increments = drift + diffusion
    log_paths = np.cumsum(log_increments, axis=1)
    paths = current_price * np.exp(log_paths)

    # Determine direction and count hits
    if target >= current_price:
        hits = np.any(paths >= target, axis=1).sum()
    else:
        hits = np.any(paths <= target, axis=1).sum()

    hits = int(hits)
    prob, ci_lower, ci_upper = wilson_interval(hits, NUM_SIMULATIONS)

    # Macro adjustment for gold
    macro = fetch_macro()
    macro_adj = 0.0
    if asset == "gold":
        dxy_change = macro.get("dxy", {}).get("change_pct", 0) or 0
        tnx_change = macro.get("tnx", {}).get("change_pct", 0) or 0
        # Rising yields + strengthening USD → bearish for gold
        if dxy_change > 0 and tnx_change > 0:
            macro_adj = -0.05
        elif dxy_change < 0 and tnx_change < 0:
            macro_adj = 0.03
        prob = round(max(0, min(1, prob + macro_adj)), 4)
        ci_lower = round(max(0, ci_lower + macro_adj), 4)
        ci_upper = round(min(1, ci_upper + macro_adj), 4)

    return {
        "probability": prob,
        "confidence_lower": ci_lower,
        "confidence_upper": ci_upper,
        "current_price": round(current_price, 2),
        "target": target,
        "asset": asset,
        "horizon_days": horizon_days,
        "simulations": NUM_SIMULATIONS,
        "daily_mu": round(mu, 6),
        "daily_sigma": round(sigma, 6),
        "macro_adjustment": macro_adj,
        "macro_factors": macro,
    }, None


@app.route("/simulate", methods=["POST"])
def simulate():
    body = request.get_json(force=True)
    asset = body.get("asset", "gold").lower()
    target = body.get("target")
    horizon = body.get("horizon_days", 30)

    if target is None:
        return jsonify({"error": "target is required"}), 400

    try:
        target = float(target)
        horizon = int(horizon)
    except (ValueError, TypeError):
        return jsonify({"error": "target must be numeric"}), 400

    result, error = run_simulation(asset, target, horizon)
    if error:
        return jsonify({"error": error}), 400

    result["question"] = body.get("question", f"Will {asset} hit ${target}?")
    return jsonify(result)


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "service": "monte-carlo-worker"})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=4001, debug=False)
