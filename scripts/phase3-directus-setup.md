# Phase 3: Directus Row-Level Permissions Setup

After running the migration script, configure Directus so each leader's token
only returns their own projects — even if the client-side filter is bypassed.

---

## Step 1 — Add `leader_id` M2O field on `projects`

1. Go to **Settings → Data Model → projects**
2. Click **+ Create Field**
3. Type: **Many to One**
4. Field key: `leader_id`
5. Related collection: `karyawan`
6. Save field

Then run the migration script to backfill existing rows:
```
node scripts/migrate-leader-to-fk.mjs --dry-run   # preview
node scripts/migrate-leader-to-fk.mjs              # apply
```

---

## Step 2 — Add `karyawan_id` on `directus_users`

Each Directus user account for a leader needs a link back to their `karyawan` record.

1. Go to **Settings → Data Model → directus_users** (system collection)
2. Click **+ Create Field**
3. Type: **Integer** (or Many to One to `karyawan`)
4. Field key: `karyawan_id`
5. Save field

Then for each leader's Directus user account, set `karyawan_id` to their `karyawan.id`.
You can do this in bulk via the API:

```js
// Example: set karyawan_id=5 for Directus user abc-123
await fetch('https://directus.eltamaprimaindo.com/users/abc-123', {
  method: 'PATCH',
  headers: { Authorization: 'Bearer ADMIN_TOKEN', 'Content-Type': 'application/json' },
  body: JSON.stringify({ karyawan_id: 5 })
});
```

---

## Step 3 — Create "Leader" role in Directus

1. Go to **Settings → Roles & Permissions**
2. Click **+ Create Role**
3. Name: `Leader`
4. Save

Assign this role to all leader user accounts in **Settings → Users**.

---

## Step 4 — Set row-level permission filter on `projects`

1. Go to **Settings → Roles & Permissions → Leader**
2. Find the **projects** collection row
3. Under **Read** column, click the filter icon (currently "All Access" or "No Access")
4. Select **Custom** and enter this filter:

```json
{
  "leader_id": {
    "_eq": "$CURRENT_USER.karyawan_id"
  }
}
```

5. Set allowed fields: check all fields leaders need (id, name, lokasi, leader, leader_id, nomor_po, status, etc.)
6. Save

Directus will now enforce this at the database query level — even with a valid
leader token, the API will only return projects where `leader_id` equals the
authenticated user's `karyawan_id`.

---

## Step 5 — Verify

```bash
# Get a leader's token (already stored in Firestore as directusPassword)
curl -X POST https://directus.eltamaprimaindo.com/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"leader@example.com","password":"their_password"}'

# Use that access_token to list projects — should only return their own
curl https://directus.eltamaprimaindo.com/items/projects \
  -H "Authorization: Bearer ACCESS_TOKEN"
```

---

## How this works end-to-end

```
Firebase Auth (login)
  → Firestore /users/{uid} → directusPassword
  → POST /auth/login → directus access_token (stored in authStore)
  → GET /items/projects?filter[leader_id][_eq]=<karyawanId>
      + Authorization: Bearer <leader_token>
  → Directus applies BOTH the query filter AND the role permission filter
  → Returns only that leader's projects
```

Even if the client-side filter is removed or tampered with, the row-level
permission in Directus prevents returning other leaders' data.
