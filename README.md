# `@shoprag/shop-youtube-channel`

This is a Shop plugin for [ShopRAG](https://github.com/shoprag/core), designed to fetch and synchronize data from a YouTube channel. It integrates seamlessly with ShopRAG's data pipeline, allowing you to pull various types of content from videos in a specified channel, apply filters, and keep your local dataset up-to-date with changes from YouTube.

---

## Features

- **Fetch data from a YouTube channel**: Specify a channel ID to pull videos and associated content.
- **Multiple content modes**: Choose to fetch video metadata, thumbnails, transcripts, video URLs, or, coming soon, audio.
- **Filtering options**: Refine video selection with filters like title patterns, duration constraints, and publication date.
- **Efficient updates**: Detects new videos to add and old videos to delete based on the specified filters.
- **Drop old videos**: Automatically remove videos older than a specified age (e.g., one year).

---

## Installation

To use this Shop plugin, you need to have [ShopRAG](https://github.com/shoprag/core) installed globally. Then, install this plugin globally via npm:

```bash
npm install -g @shoprag/shop-youtube-channel
```

---

## Usage

Follow these steps to configure and run the plugin in your ShopRAG project.

### Step 1: Configure `shoprag.json`

In your ShopRAG project directory, add this Shop to your `shoprag.json` file under the `Shops` array. Below is an example configuration:

```json
{
  "Project_Name": "YouTubeSync",
  "ShopRAG": "1.0",
  "Shops": [
    {
      "from": "youtube-channel",
      "config": {
        "channelId": "UC_x5XG1OV2P6uZZ5FSM9Ttw",
        "mode": "transcript",
        "titleIncludes": "tutorial",
        "durationMoreThan": 300,
        "durationLessThan": 600,
        "dropAfter": "1y",
        "startDate": "2023-01-01"
      }
    }
  ],
  "RAGs": [
    {
      "to": "dir",
      "config": {
        "outputDir": "./data"
      }
    }
  ]
}
```

### Step 2: Provide Credentials

This Shop requires a YouTube Data API key to authenticate API requests. If you haven’t already provided one, ShopRAG will prompt you to enter your API key when you run the pipeline.

To generate an API key:
1. Go to the [Google Developers Console](https://console.developers.google.com/).
2. Create a new project or select an existing one.
3. Enable the **YouTube Data API v3**.
4. Create an API key and copy it.
5. Provide the API key when prompted by ShopRAG.

Your API key will be securely stored in `~/.shoprag/creds.json` for future use.

### Step 3: Run ShopRAG

Once configured, run the ShopRAG pipeline:

```bash
shoprag
```

The plugin will:
- Fetch videos from the specified YouTube channel.
- Apply the specified filters to select relevant videos.
- Fetch content based on the chosen mode (e.g., transcripts).
- Add new videos and remove old or filtered-out videos from the dataset.

---

## Configuration Options

The following options can be specified in the `config` object of your `shoprag.json`:

| Option              | Description                                                                 | Default       |
|---------------------|-----------------------------------------------------------------------------|---------------|
| `channelId`         | The ID of the YouTube channel (e.g., `"UC_x5XG1OV2P6uZZ5FSM9Ttw"`).         | **Required**  |
| `mode`              | The type of content to fetch: `"metadata"`, `"thumbnail"`, `"transcript"`, `"video"`, or `"audio"`. | `"metadata"` |
| `titleIncludes`     | A RegEx pattern that video titles must match (e.g., `"tutorial"`).          | None          |
| `durationMoreThan`  | Minimum video duration in seconds (e.g., `300` for 5 minutes).              | None          |
| `durationLessThan`  | Maximum video duration in seconds (e.g., `600` for 10 minutes).             | None          |
| `dropAfter`         | Deletes videos older than this duration (e.g., `"1y"` for one year).        | None          |
| `startDate`         | Excludes videos published before this date (e.g., `"2023-01-01"`).          | None          |

### Modes Explained

- **`metadata`**: Fetches video metadata (title, description, etc.) as a JSON string.
- **`thumbnail`**: Fetches the high-resolution thumbnail URL.
- **`transcript`**: Fetches the video transcript (if available) or a fallback message.
- **`video`**: Provides the direct YouTube video URL.
- **`audio`**: Provides audio extraction (not yet implemented).

---

## How It Works

- **First Run**: Adds all videos from the channel that match the filters, fetching content based on the specified mode.
- **Subsequent Runs**:
  - Fetches the current list of videos from the channel.
  - Applies filters to determine which videos to include.
  - Adds new videos that match the filters.
  - Deletes videos that no longer match the filters or exceed the `dropAfter` age.
- **File IDs**: Each video is assigned a unique ID like `youtube-channel-<channelId>-<videoId>-<mode>`, ensuring no conflicts across channels or modes.

This approach ensures that only relevant videos are added or retained, and unnecessary data is removed efficiently.

---

## Troubleshooting

- **Invalid channel ID**: Ensure the `channelId` is correct and corresponds to a valid YouTube channel.
- **Missing API key**: If prompted for an API key, make sure to provide a valid YouTube Data API key.
- **API quota limits**: The YouTube API has usage quotas. If you hit limits, consider reducing the frequency of runs or optimizing filters.
- **Transcript not available**: Some videos may not have transcripts; the plugin will provide a fallback message in such cases.
- **Audio mode**: Currently a placeholder; audio extraction is not implemented due to complexity.

---

## Contributing

Contributions are welcome! Please open an issue or submit a pull request on [GitHub](https://github.com/shoprag/shop-youtube-channel).

---

## License

This project is licensed under the MIT License.
