# Spellpool Dial: the device API

A Spellpool Dial is a round touch screen with a knob (a Waveshare
ESP32-S3-Knob-Touch-LCD-1.8) that sits by a deck: it shows the commander
and counts life. Its firmware lives in its own repository. This is the
server side, and the contract the firmware is written against.

`scripts/dial-sim.mjs` plays a dial against these routes, with no hardware:

```
node scripts/dial-sim.mjs https://www.spellpool.com --out ./dial-art
```

## How a dial belongs to an account

A dial has no keyboard, so it never sees a password. It pairs the way a TV
signs in to a streaming service.

1. **The dial asks for a code.** `POST /api/device/pair/start`
   - Body: `{ "firmware": "0.1.0" }` (optional).
   - Answer: `{ code, secret, expiresIn, pollEvery, url }`.
   - `code` is six characters from the game codes' alphabet (no 0/O, 1/I/L).
     The dial shows it as `K7M 2QF`, with `url` (`spellpool.com/dial`).
   - `secret` is the dial's alone. It never shows it.
   - `expiresIn` is seconds (600). `pollEvery` is seconds (3).
2. **Its owner types the code** at `/dial`, signed in. The page calls
   `POST /api/device/pair/claim { code, name? }`.
3. **The dial collects its token.** `POST /api/device/pair/poll { code, secret }`
   - `202 { status: "pending" }`: nobody typed it yet. Ask again in `pollEvery`.
   - `200 { status: "paired", token, device: { id, name }, player }`: once.
     The dial stores `token` and never asks again.
   - `404`: the code expired, or the secret isn't this code's. Start again.

The token starts with `spd_`. Only its SHA-256 is stored (`Device.tokenHash`),
as with sessions. The pairing row is deleted as the token is handed over, so
a second poll makes no second device.

## What a paired dial asks

Every request carries `Authorization: Bearer <token>`, and may carry
`X-Dial-Firmware: 0.1.0`. A `401 { code: "unpaired" }` means the dial was
removed on the web: forget the token and show the pairing screen.

### `GET /api/device/decks`

The decks its owner sent to this dial.

```json
{
  "device": { "id": 3, "name": "Desk dial" },
  "player": "kike",
  "decks": [
    {
      "id": "JYuAp-0a2CXORjac",
      "name": "Kefka storm",
      "format": "commander",
      "commander": "Kefka, Court Mage // Kefka, Ruler of Ruin",
      "colors": "UBR",
      "bracket": 3,
      "score": 6.4,
      "gamesPlayed": 12,
      "gamesWon": 5,
      "art": "9f2c41d07ab3"
    }
  ]
}
```

- `colors` is the colour identity in WUBRG order; `""` is colourless.
- `bracket` and `score` are null for a deck that was never scanned.
- `art` is a tag of the picture's source. Download the art again only when
  it changes. Null: the deck has no commander art.
- Sent with an `ETag`. Send it back as `If-None-Match`: nothing new is a `304`.
- A double-faced commander's name has both faces, split by ` // `.

### `GET /api/device/art/<deck id>`

The commander's art for the screen: 360 × 360.

- Default: a **baseline** JPEG, about 30 KB (small decoders can't read
  progressive ones).
- `?format=rgb565`: raw pixels, 16 bits each, little-endian, row by row:
  259,200 bytes. For a firmware with no JPEG decoder.
- `ETag` is `"<the deck's art tag>"`. `404`: the deck isn't on this dial, or
  has no art. `502`: Scryfall's image host couldn't be reached; try later.

The server fetches the art crop from `cards.scryfall.io` and resizes it
(`lib/device-art.ts`). The dial never talks to Scryfall.

## The owner's side

- `/dial`: pair a dial, rename or remove it, tick the decks it carries.
  `/dial?send=<deck id>` (a deck page's "Send to dial") sends that deck: at
  once with one dial, with a choice when there are several.
  The deck page's "Send to dial" and the account page's link show only for
  an account that has a dial: a new dial shows the address itself.
- `GET /api/dials`, `PATCH` and `DELETE /api/dials/<id>`,
  `POST /api/dials/<id>/decks { deck, on }`.
- Limits: 10 dials an account, 40 decks a dial. Only your own decks.

## Limits

- `pair/start`: 10 per address per 10 minutes.
- `pair/poll`: 90 a minute per address.
- `pair/claim`: 10 per account and 20 per address per 10 minutes.
- Paired routes: 120 a minute per address.

## Not built yet

- `POST /api/device/games`: finished games, sent in batches when the dial
  next sees Wi-Fi, safe to send twice.
- A friend's deck by game code is already there: `GET /api/play/<code>` and
  `POST /api/play/<code>/result`.
- Firmware updates over Wi-Fi.
