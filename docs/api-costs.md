# QClaw Cost Tracking API

## Authentication
All endpoints require the dashboard token as a query parameter.

Get token from: http://127.0.0.1:4000 (shown in startup logs)

## Endpoints

### Total Costs Summary
bash
curl "http://localhost:4000/api/costs?token=YOURTOKEN"
```

Returns:
- `today`: Total cost for today (£)
- `week`: Total cost for last 7 days (£)
- `month`: Total cost for last 30 days (£)
- `todaymsgs: Message count today
- weekmsgs`: Message count this week

### Cost Breakdown by Channel
```bash
curl "http://localhost:4000/api/costs/by-channel?token=YOURTOKEN&period=week"
Parameters:
- `period`: `today` (default), `week`, or `month`

Returns array of:
- `channel`: Channel name (telegram, cli, etc.)
- `messages`: Number of messages
- `total_cost`: Total cost for this channel (£)
- `avg_cost`: Average cost per message (£)

## Example Usage
bash
# Set your token
TOKEN="5a93ec9981e0aab9bd8908529bd90bec"

# Get weekly costs by channel
curl -s "httocalhost:4000/api/costs/by-channel?token=$TOKEN&period=week" | jq '.'

# Compare to total costs
curl -s "http://localhost:4000/api/costs?token=$TOKEN" | jq '.'
## Current Results

Today's costs: £2.05 (174 messages)
- Telegram: £0.25 (22 messages, £0.011 avg)
- CLI: £0.01 (1 message, £0.008 avg)

Week's costs: £5.45 (478 messages)
