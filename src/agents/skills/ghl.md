---
name: ghl
category: on-demand
surface: both
keywords: [ghl, contacts, opportunities, conversations]
tools: [ghl__search_contacts, ghl__get_contact, ghl__list_opportunities, ghl__list_pipelines]
description: GoHighLevel CRM HTTP surface — contacts, opportunities, tasks, notes, conversation messages
---

# GoHighLevel CRM
## Auth
Base URL: https://services.leadconnectorhq.com
Header: Authorization: Bearer {{secrets.ghl_api_key}}
Header: Version: 2021-07-28
Header: Location-Id: {{secrets.ghl_location_id}}
## Endpoints
GET /contacts/?locationId={{secrets.ghl_location_id}}&limit=25 - List contacts
GET /contacts/search?locationId={{secrets.ghl_location_id}}&query={{query}} - Search contacts by name/email
GET /contacts/{{contact_id}} - Get contact by ID
POST /contacts/ - Create contact
PUT /contacts/{{contact_id}} - Update contact
GET /opportunities/search?locationId={{secrets.ghl_location_id}} - Search opportunities
POST /opportunities/ - Create opportunity
POST /tasks/ - Create task
POST /notes/ - Create note
## Permissions
- http: [services.leadconnectorhq.com]
- shell: none
- file: none
## Usage Notes
- Always check for duplicate contacts before creating (search by email/phone)
- Location-Id header is required for all requests
- Use British English in notes/communications

## Notification email pattern (out of GHL)
GHL has no transactional send-to-arbitrary-address endpoint. POST /conversations/messages with type=Email requires a contactId; the email is sent to that contact's email. To send notifications out of GHL, we maintain an internal-use contact for the recipient (Tyson at FSC) and use its id. Stored as GHL_FSC_NOTIFY_CONTACT_ID. Same pattern for new locations: create or look up a contact for the operator's email, save the id.
