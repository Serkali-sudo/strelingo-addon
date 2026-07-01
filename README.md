# Strelingo Stremio Addon

This Stremio addon fetches subtitles for movies and series from OpenSubtitles and merges two language tracks into a single subtitle file. This is particularly useful for language learners who want to see subtitles in both their native language and the language they are learning simultaneously.

![Ekran görüntüsü 2025-04-18 142351](https://github.com/user-attachments/assets/d2441e6c-82b7-4115-876d-1af0e419f6df)

## Deployment

### Cloudflare Workers
Deploy to Cloudflare Workers in one click:

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Serkali-sudo/strelingo-addon)

### Vercel
You can easily deploy this addon and host it yourself on Vercel by clicking the button below. The free hobby plan is more than enough for personal use. You may need to set up Vercel Blob storage.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/import/project?template=https://github.com/Serkali-sudo/strelingo-addon)

### Docker
```bash
docker compose up -d
```

## Demo Live Addon Url
You can either add the Stremio addon by copying this and use add addon in stremio:
 ```bash 
 https://strelingo.pronouncetube.com/manifest.json
 ```
or visit the addon page here:  
[https://strelingo.pronouncetube.com](https://strelingo.pronouncetube.com).

## Providers
* OpenSubtitles.
* [Buta no subs Stremio addon](https://github.com/Pigamer37/buta-no-subs-stremio-addon) for better japanese subtitles (Implemented by @Pigamer37).

## Features

*   Fetches subtitles from OpenSubtitles.
*   Automatically detects the best available subtitles for two selected languages.
*   Handles Gzip compressed subtitles.
*   **Robust encoding detection:** Handles UTF-16 LE/BE (with BOM), double-encoded BOMs, legacy encodings (Windows-1251, ISO-8859-x), and repairs double-encoded UTF-8 text (Implemented by @ravisorg).
*   Merges the main language and translation language subtitles into a single `.srt` file.
*   Formats the translation line to be *italic* and <font color="yellow">yellow</font> (yellow color doesnt work due to stremio overriding the color of subtitles).
*   **Auto-detects your browser language** and sets it as the default translation language on first use!
*   Configurable via Stremio addon settings for:
    *   Main Language (Audio Language)
    *   Translation Language (Your Language)

## Requirements

*   [Node.js](https://nodejs.org/) (Version 18 or higher)
*   [npm](https://www.npmjs.com/)
*   Storage modes reuse existing generated subtitles when the same movie/episode, language pair, and version filename already exists.
*   **Storage / Serving Configuration** - Configure your choice via the `.env` file (see [`.env.example`](.env.example) for all options):
    *   **Option 1: Vercel Blob** (cloud) - Create a Vercel Blob in [Vercel Dashboard](https://vercel.com/dashboard/stores), copy the token, and put it in your `.env` as `BLOB_READ_WRITE_TOKEN`
    *   **Option 2: S3-Compatible Storage** (cloud / self-hosted) - Configure `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, and `S3_PUBLIC_BASE_URL`. Works with AWS S3, Cloudflare R2, Supabase Storage S3, Backblaze B2, DigitalOcean Spaces, Wasabi, MinIO, and similar providers.
    *   **Option 3: Local File Storage** (self-hosted) - Set `LOCAL_STORAGE_DIR=./subtitles` in your `.env`. Useful for running on your home network or private server.
    *   **Option 4: Direct Serving** (self-hosted / Cloudflare Workers) - Set `ENABLE_DIRECT_SERVING=true` in your `.env`. Serves merged subtitles directly from the addon instance using signed lazy URLs. Best for self-hosted setups or Cloudflare Workers.
*   For S3-compatible storage, `S3_ENDPOINT` is required for providers like Cloudflare R2, Supabase Storage S3, Spaces, B2, Wasabi, and MinIO, but can usually be omitted for regular AWS S3. `S3_PUBLIC_BASE_URL` is app-specific: it is the public-read URL base returned to Stremio, not an AWS SDK setting.
*   Set `ENABLE_STORAGE_LAZY_SERVING=true` if storage modes should merge only when Stremio clicks a subtitle. Leave it unset to check storage first, then process missing subtitles during the listing request.
*   Set `SUBTITLE_PAYLOAD_SECRET` for direct-serving installs. Vercel Blob and S3 secret keys can be used for signing automatically when present.

## Local Setup

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/Serkali-sudo/strelingo-addon
    cd strelingo-addon
    ```
2.  **Install dependencies:**
    ```bash
    npm install
    ```
3.  **Configure storage** (create `.env` file):
    ```bash
    # Copy the example configuration
    cp .env.example .env

    # Edit .env and configure your preferred storage option
    ```
    See [`.env.example`](.env.example) for all available options and detailed configuration examples.

## Running the Addon Locally

Start the addon server locally:
```bash
npm start
```

Or run in development mode with auto-reload:
```bash
npm run dev:node
```

The addon will be available at `http://localhost:7000/manifest.json`.

## Installing and Configuring in Stremio

1.  Ensure the addon server is running locally (see "Running the Addon Locally").
2.  Open your web browser and navigate to the addon's local address (usually `http://localhost:7000/` or the address shown in the console when you start it).
3.  On the addon configuration page that loads:
    *   Select your desired **Main Language** (typically the language the audio is in).
    *   Select your desired **Translation Language** (typically your native language or the one you want for comparison).
    *   **Note:** The Translation Language field is automatically pre-filled with your browser's language if not previously configured!
4.  Click the "Install Addon" button or link displayed on the page (it might be at the bottom).
5.  Your browser might ask for permission to open the link with Stremio. Allow it.
6.  Stremio should open and prompt you to confirm the installation **with your selected configuration**. Click "Install".

The addon is now installed and configured with your chosen languages.

## Testing

Run encoding tests to verify subtitle decoding works correctly across 40+ languages:

```bash
npm test                                # Run all tests
npx tsx test/encoding.test.ts --output  # Save decoded files to test/output/
npx tsx test/download-inputs.ts         # Re-download all test inputs
npx tsx test/download-inputs.ts tt123456 # Download specific movie
```

Tests validate that decoded subtitles contain expected native-language strings (not just English). To add a new test movie, edit `test/movies.ts`.

## Technical Details

*   **Backend:** Node.js + TypeScript
*   **Framework:** Hono (works on Vercel, Cloudflare Workers, and Node.js)
*   **Subtitle Source:** OpenSubtitles API, [Buta no Subs Stremio addon](https://github.com/Pigamer37/buta-no-subs-stremio-addon)
*   **HTTP Requests:** Native fetch
*   **Subtitle Parsing:** `srt-parser-2` + built-in multi-format converter
*   **Gzip Decompression:** `pako`
*   **Character Encoding Detection:** `chardet`
*   **Character Encoding Decoding:** `iconv-lite` 
