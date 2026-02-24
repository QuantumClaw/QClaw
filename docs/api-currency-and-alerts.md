# Currency Conversion & Spike Detection API

## New Endpoints

### 1. Get Supported Currencies

**Endpoint:**
GET /api/currencies?token=YOURTOKEN
```

**Response:**
```json
{
  "currencies": ["USD", "EUR", "GBP", "JPY", "AUD", "CAD"]
}
```

---

### 2. Convert Costs to Another Currency

**Endpoint:**
```
GET /api/costs/convert?token=YOURTOKEN&currency=USD&period=week
**Parameters:**
- currency: Target currency (USD/EUR/GBP/JPY/AUD/CAD)
- period: today, week, or month

**Response:**
json
{
  "period": "week",
  "sourcecurrency": "GBP",
  "targetcurrency": "USD",
  "sourceamount": 5.76,
  "convertedamount": 7.77
}
---

### 3. Check for Usage/Cost Spikes

**Endpoint:**
GET /api/alerts/check?token=YOURTOKEN&period=hour
```

**Parameters:**
- period: hour, day, or week

**Response (No spike):**
```json
{
  "spike": false,
  "reason": "Insufficient historical data"
}
```

**Response (Spike detected):**
```json
{
  "spike": true,
  "alert": {
    "timestamp": 1704067200000,
    "period": "hour",
    "current": { "cost": 15.50, "messages": 250 },
    "average": { "cost": 5.20, "messages": 80 },
    "multiplier": { "cost": "2.98", "messages": "3.13" },
    "type": "usage"
  }
}
```

---

### 4. Get Recent Alerts

**Endpoint:**
```
GET /api/alerts?token=YOURTOKEN&limit=10
**Response:**
json

  {
    "timestamp": 1704067200000,
    "period": "hour",
    "current": { "cost": 15.50, "messages": 250 },
    "average": { "cost": 5.20, "messages": 80 },
    "multiplier": { "cost": "2.98", "messages": "3.13" },
    "type": "usage"
  }

---

## Implementation Details

**Currency Conversion:**
- Uses exchangerate-api.com for live rates
- Caches rates for 1 hour to reduce API calls
- Falls back to hardcoded rates if API fails
- Base currency: GBP

**Spike Detection:**
- Compares current period to last 7 historical periods
- Triggers alert if usage/cost exceeds 2.5x average
- Requires minimum 5 historical data points
- Stores alerts in data/spike-alerts.json
- Console warning logged when spike detected

---

## Testing Examples

Replace YOUR_TOKEN with your actual dashboard token.

Test currency conversion:
curl "http://localhost:4000/api/currencies?token=YOURTOKEN"
curl "http://localhost:4000/api/costs/convert?token=YOURTOKEN&currency=USD&period=week"
Test spike detection:
curl "http://localhost:4000/api/alerts/check?token=YOURTOKEN&period=hour"
curl "http://localhost:4000/api/alerts?token=YOURTOKEN&limit=5"
---

## Notes

- All endpoints require authentication token
- Spike detection needs 7+ historical periods to work
- Exchange rates update hourly automatically
- Alerts are retained (last 100 entries)
