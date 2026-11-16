# The data feed

The data feed puts one line of your own numbers on the dashboard: an account balance, a
savings goal, a home sensor, anything you can write to a file. The TV fetches the file itself
about every 5 minutes. Nothing goes through a TeleDash server (there isn't one).

You set it on the phone setup page under **Data feed**:

| Setting | Meaning |
|---|---|
| Enabled | Show the feed or not. Off by default. |
| Title | Shown above the numbers. In CSV mode it is also the item's label. |
| Address | An `https://` address, or a `github:` address (below). |
| Format | `json` (TeleDash feed v1) or `csv`. |
| CSV columns | CSV only: which columns hold the date, value, money added, and time. |
| Key (optional) | A token sent with the request. Stored only on the TV; never shown again. |

## Addresses

### Any HTTPS address

```
https://example.com/my-feed.json
```

If a key is set, it is sent as `Authorization: Bearer <key>` to this address. **Only set a key
when the address belongs to the service that issued the key.** The TV ties the key to the site
the feed address points at when you save the key (or, if no address is set yet, the first one you
save afterwards) and sends it only there. If you later change the address to a different site,
the TV deletes the key, so it can never be sent somewhere else; paste it again if that is what
you meant.

### Files in a GitHub repository

```
github:<owner>/<repo>/<path>[@<ref>]
```

Examples:

```
github:example-user/home-data/feed.json
github:example-user/home-data/data/balance.csv@main
```

The TV turns this into a request to GitHub's API,
`https://api.github.com/repos/<owner>/<repo>/contents/<path>?ref=<ref>`, asking for the raw file.
Leave out `@<ref>` to use the repository's default branch. For a private repository, add a key
(see [Making a read-only GitHub key](#making-a-read-only-github-key)).

## Format `json`: TeleDash feed v1

```json
{
  "title": "Account",
  "asOf": "2026-01-02 15:00",
  "items": [
    { "label": "Value", "value": 1234.5, "change": 12.3, "format": "usd" },
    { "label": "Return this year", "value": 4.2, "format": "percent" },
    { "label": "Trades", "value": 17 }
  ]
}
```

| Field | Meaning |
|---|---|
| `title` | Heading for the feed. |
| `asOf` | Free text shown as "as of"; any readable date and time. |
| `items` | A list of things to show, in order. Keep it short: it is one line on a TV. |
| `items[].label` | Name of the number. |
| `items[].value` | A number (not a string). |
| `items[].change` | Optional. A number shown as the change, for example since yesterday. |
| `items[].format` | Optional. `"usd"` (dollars), `"number"` (plain) or `"percent"`. Default `"number"`. |

## Format `csv`: last row of a spreadsheet

Useful when something already appends a row to a CSV file every day. The file must have a
**header row**. You name the columns on the setup page:

| Setting | Default | Required | Meaning |
|---|---|---|---|
| date column | `date` | yes | The row's date. Use `YYYY-MM-DD` so dates compare correctly. |
| value column | `value` | yes | The number to show. |
| flows column | (empty) | no | Running total of money added minus money taken out, so deposits are not counted as gains. |
| time column | (empty) | no | A time to show next to the date. |

How the line is worked out:

1. **Value**: from the **last row whose value column is not empty**.
2. **Change**: that value minus the value on the last row with an **earlier date**. If a flows
   column is named, the change in flows between those two rows is subtracted too.
3. **As of**: that row's date, plus its time if a time column is named.
4. The single item shown uses the feed's **title** as its label (or `Value` if the title is
   empty) and is formatted as dollars.

Example, with the flows column set to `flows` and the time column to `time`:

```csv
date,time,value,flows
2026-01-01,16:00,1000.00,1000
2026-01-02,10:00,1010.00,1000
2026-01-02,16:00,1520.00,1500
```

- Value: `1520.00` (last row).
- Last row with an earlier date: `2026-01-01`, value `1000.00`, flows `1000`.
- Change: `(1520 − 1000) − (1500 − 1000) = 20`. The 500 deposited is not counted as a gain.
- As of: `2026-01-02 16:00`.

## Making a read-only GitHub key

If your feed file is in a private GitHub repository, the TV needs a key to read it. Make the
key as weak as possible: **read-only, one repository, expiring**. Then if it ever leaks, the
damage is limited to reading that one repository until the date you chose.

1. On GitHub, open **Settings → Developer settings → Personal access tokens →
   Fine-grained tokens** and choose **Generate new token**.
2. **Token name**: for example `TeleDash TV feed`.
3. **Expiration**: pick a date, for example 90 days. Avoid "No expiration".
4. **Resource owner**: the account or organisation that owns the repository.
5. **Repository access**: **Only select repositories**, then pick **just the one repository**
   that holds the feed file.
6. **Permissions → Repository permissions → Contents: Read-only**. Leave everything else at
   "No access". (GitHub adds "Metadata: Read-only" by itself; that is expected.)
7. Generate the token and copy it. GitHub shows it only once.
8. On the TeleDash Pro setup page, paste it into **Data feed → Key** and save.

Good habits:

- Put the feed file in a small repository of its own, so the key cannot read anything else.
- Put a reminder in your calendar a few days before the key expires. When it does, the feed
  shows an error until you make a new key and paste it in.
- If the repository belongs to an organisation, the organisation may have to approve
  fine-grained keys before they work *(Assumed: depends on the organisation's settings)*.
- To withdraw it: delete the key on GitHub (it stops working at once), and remove it on the
  setup page.

Public repositories need no key.

## When it goes wrong

The dashboard shows a short error in place of the numbers. Common causes:

| Symptom | Check |
|---|---|
| Not found (404) | The owner, repository, path or branch in the `github:` address, or that the key can see that repository. |
| Not allowed (401/403) | The key has expired, was deleted, or lacks Contents: Read-only on that repository. |
| Could not read the feed | The JSON is not valid, `value` is a string rather than a number, or the CSV has no header row or no matching column names. |
