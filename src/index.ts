import { Shop, JsonObject } from '@shoprag/core';
import { google, youtube_v3 } from 'googleapis';
import { YoutubeTranscript } from 'youtube-transcript';
import moment from 'moment';
import cliProgress from 'cli-progress';

/**
 * Configuration interface for the YouTubeChannelShop.
 */
interface Config {
    channelId: string;
    mode?: string;
    noDelete?: boolean;
    titleIncludes?: string;
    durationMoreThan?: string;
    durationLessThan?: string;
    dropAfter?: string;
    startDate?: string;
    includeHeader?: boolean; // New option: include header in transcript mode, defaults to true
}

/**
 * Interface for filter settings.
 */
interface Filters {
    titleIncludes?: RegExp;
    durationMoreThan?: number;
    durationLessThan?: number;
    dropAfter?: string;
    startDate?: string;
}

/**
 * YouTube Channel Shop plugin for ShopRAG.
 * Fetches data from a YouTube channel based on filters and delivers it in one of five modes.
 * 
 * **Config options:**
 * - `channelId`: The ID of the YouTube channel to fetch videos from (required).
 * - `mode`: Content type to fetch ('metadata', 'thumbnail', 'transcript', 'video', 'audio'). Default: 'metadata'.
 * - `titleIncludes`: Regex pattern to filter videos by title.
 * - `durationMoreThan`: Minimum video duration in seconds.
 * - `durationLessThan`: Maximum video duration in seconds.
 * - `dropAfter`: Drop videos older than this duration (e.g., '1y' for one year).
 * - `startDate`: Only include videos published after this date (ISO format).
 * - `noDelete`: If true, prevents deletion of files even if they no longer match filters. Default: false.
 * - `includeHeader`: If true, includes a header with metadata in transcript mode. Default: true.
 */
export default class YouTubeChannelShop implements Shop {
    private youtube: youtube_v3.Youtube; // Typed YouTube API client
    private channelId: string;
    private mode: string;
    private noDelete: boolean = false;
    private includeHeader: boolean = true; // Default to true for transcript header
    private filters: Filters;

    /**
     * Defines the credentials required by this Shop.
     * @returns Object specifying the required YouTube API key and instructions.
     */
    requiredCredentials(): { [credentialName: string]: string } {
        return {
            youtube_api_key: `To obtain a YouTube API key:
1. Go to https://console.developers.google.com/
2. Create a new project or select an existing one.
3. Enable the YouTube Data API v3.
4. Create an API key and copy it here.`
        };
    }

    /**
     * Initializes the Shop with credentials and configuration.
     * @param credentials User-provided credentials containing the YouTube API key.
     * @param config Configuration object from shoprag.json.
     */
    async init(credentials: { [key: string]: string }, config: JsonObject): Promise<void> {
        const apiKey = credentials['youtube_api_key'];
        if (!apiKey) {
            throw new Error('YouTube API key is required.');
        }
        this.youtube = google.youtube({
            version: 'v3',
            auth: apiKey
        });
        const cfg = config as unknown as Config;
        this.channelId = cfg.channelId;
        if (!this.channelId) {
            throw new Error('channelId is required in config.');
        }
        this.mode = cfg.mode || 'metadata';
        this.noDelete = cfg.noDelete === true;
        this.includeHeader = cfg.includeHeader !== false; // Default to true unless explicitly false
        this.filters = {
            titleIncludes: cfg.titleIncludes ? new RegExp(cfg.titleIncludes) : undefined,
            durationMoreThan: cfg.durationMoreThan ? parseInt(cfg.durationMoreThan, 10) : undefined,
            durationLessThan: cfg.durationLessThan ? parseInt(cfg.durationLessThan, 10) : undefined,
            dropAfter: cfg.dropAfter,
            startDate: cfg.startDate
        };
    }

    /**
     * Fetches all video IDs from the channel using pagination.
     * @returns Promise resolving to an array of video IDs.
     */
    private async getChannelVideoIds(): Promise<string[]> {
        let videoIds: string[] = [];
        let nextPageToken: string | undefined = undefined;
        do {
            const response = await this.youtube.search.list({
                part: ['id'],
                channelId: this.channelId,
                maxResults: 50,
                pageToken: nextPageToken,
                type: ['video']
            });
            const items = response.data.items as youtube_v3.Schema$SearchResult[];
            videoIds.push(...items.map(item => item.id?.videoId).filter((id): id is string => id !== undefined));
            nextPageToken = response.data.nextPageToken;
        } while (nextPageToken);
        return videoIds;
    }

    /**
     * Fetches detailed video information in batches with a progress bar.
     * @returns Promise resolving to an array of video details.
     */
    private async getAllVideoDetails(): Promise<youtube_v3.Schema$Video[]> {
        const videoIds = await this.getChannelVideoIds();
        const details: youtube_v3.Schema$Video[] = [];
        const batchSize = 50;
        const numBatches = Math.ceil(videoIds.length / batchSize);

        const progressBar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
        progressBar.start(numBatches, 0);

        for (let i = 0; i < videoIds.length; i += batchSize) {
            const batch = videoIds.slice(i, i + batchSize);
            const response = await this.youtube.videos.list({
                part: ['contentDetails', 'snippet'],
                id: batch.join(',')
            } as any);
            const items = response.data.items as youtube_v3.Schema$Video[];
            details.push(...items);
            progressBar.increment();
        }
        progressBar.stop();
        return details;
    }

    /**
     * Applies configured filters to the video list.
     * @param videos Array of video details.
     * @returns Filtered array of videos matching all criteria.
     */
    private applyFilters(videos: youtube_v3.Schema$Video[]): youtube_v3.Schema$Video[] {
        return videos.filter((video) => {
            const title = video.snippet?.title;
            const publishedAt = video.snippet?.publishedAt ? new Date(video.snippet.publishedAt) : undefined;
            const duration = video.contentDetails?.duration ? this.parseDuration(video.contentDetails.duration) : 0;

            if (this.filters.titleIncludes && title && !this.filters.titleIncludes.test(title)) return false;
            if (this.filters.startDate && publishedAt && publishedAt < new Date(this.filters.startDate)) return false;
            if (this.filters.durationMoreThan && duration < this.filters.durationMoreThan) return false;
            if (this.filters.durationLessThan && duration > this.filters.durationLessThan) return false;
            if (this.filters.dropAfter && publishedAt && this.shouldDropVideo(publishedAt)) return false;
            return true;
        });
    }

    /**
     * Parses ISO 8601 duration (e.g., PT1H2M3S) into seconds.
     * @param duration Duration string from YouTube API.
     * @returns Duration in seconds.
     */
    private parseDuration(duration: string): number {
        const match = duration.match(/PT(\d+H)?(\d+M)?(\d+S)?/);
        if (!match) return 0;
        const hours = match[1] ? parseInt(match[1], 10) : 0;
        const minutes = match[2] ? parseInt(match[2], 10) : 0;
        const seconds = match[3] ? parseInt(match[3], 10) : 0;
        return hours * 3600 + minutes * 60 + seconds;
    }

    /**
     * Determines if a video exceeds the dropAfter duration based on its publication date.
     * @param publishedAt Video publication date.
     * @returns True if the video should be dropped.
     */
    private shouldDropVideo(publishedAt: Date): boolean {
        if (!this.filters.dropAfter) return false;
        const age = moment.duration(moment().diff(moment(publishedAt)));
        const dropDuration = this.parseDropAfter(this.filters.dropAfter);
        return age.asMilliseconds() > dropDuration;
    }

    /**
     * Converts dropAfter duration (e.g., "1y") into milliseconds.
     * @param dropAfter Duration string (e.g., "1d", "2w", "3m", "1y").
     * @returns Duration in milliseconds.
     */
    private parseDropAfter(dropAfter: string): number {
        const unit = dropAfter.slice(-1);
        const value = parseInt(dropAfter.slice(0, -1), 10);
        switch (unit) {
            case 'd': return value * 24 * 60 * 60 * 1000; // days
            case 'w': return value * 7 * 24 * 60 * 60 * 1000; // weeks
            case 'm': return value * 30 * 24 * 60 * 60 * 1000; // months (approx)
            case 'y': return value * 365 * 24 * 60 * 60 * 1000; // years (approx)
            default: throw new Error(`Invalid dropAfter unit: ${unit}`);
        }
    }

    /**
     * Generates metadata content for a video.
     * @param video Video details object.
     * @returns JSON string of the video's snippet.
     */
    private async getMetadataContent(video: youtube_v3.Schema$Video): Promise<string> {
        return JSON.stringify(video.snippet);
    }

    /**
     * Retrieves the high-resolution thumbnail URL for a video.
     * @param video Video details object.
     * @returns Thumbnail URL string or empty string if unavailable.
     */
    private getThumbnailContent(video: youtube_v3.Schema$Video): string {
        return video.snippet?.thumbnails?.high?.url || '';
    }

    /**
     * Fetches the transcript for a video, optionally including a header.
     * @param video Video details object.
     * @returns Transcript text with optional header or an error message if unavailable.
     */
    private async getTranscriptContent(video: youtube_v3.Schema$Video): Promise<string> {
        const videoId = video.id!;
        try {
            const transcript = await YoutubeTranscript.fetchTranscript(videoId);
            const transcriptText = transcript.map((t: { text: string }) => t.text).join(' ');
            if (this.includeHeader) {
                const title = video.snippet?.title || 'Unknown Title';
                const channelName = video.snippet?.channelTitle || 'Unknown Channel';
                const videoUrl = `https://www.youtube.com/watch?v=${videoId}` || 'Unavailable';
                const dateUploaded = video.snippet?.publishedAt
                    ? new Date(video.snippet.publishedAt).toISOString()
                    : 'Unknown Date';
                return `YouTube video: ${title}\nVideo URL: ${videoUrl}\nUploaded by: ${channelName}\nDate: ${dateUploaded}\nVideo transcript follows:\n${transcriptText}\n[end of video]`;
            } else {
                return transcriptText;
            }
        } catch (error) {
            console.error(`Failed to fetch transcript for ${videoId}:`, error);
            return 'Transcript not available';
        }
    }

    /**
     * Provides the YouTube video URL.
     * @param videoId Video ID.
     * @returns Video URL string.
     */
    private getVideoContent(videoId: string): string {
        return `https://www.youtube.com/watch?v=${videoId}`;
    }

    /**
     * Placeholder for audio content extraction (not implemented).
     * @param videoId Video ID.
     * @returns Placeholder message.
     */
    private getAudioContent(videoId: string): string {
        return 'Audio extraction not yet implemented';
    }

    /**
     * Generates updates by comparing current channel videos with existing files.
     * @param lastUsed Timestamp of the last run (currently unused).
     * @param existingFiles Dictionary of existing file IDs and their timestamps.
     * @returns Dictionary of updates with actions ('add' or 'delete') and content.
     */
    async update(
        lastUsed: number,
        existingFiles: { [fileId: string]: number }
    ): Promise<{ [fileId: string]: { action: 'add' | 'update' | 'delete'; content?: string } }> {
        try {
            const videos = await this.getAllVideoDetails();
            const filteredVideos = this.applyFilters(videos);

            const updates: { [fileId: string]: { action: 'add' | 'update' | 'delete'; content?: string } } = {};
            const currentFileIds = new Set<string>();
            const newVideos: youtube_v3.Schema$Video[] = [];

            for (const video of filteredVideos) {
                const fileId = `youtube-channel-${this.channelId}-${video.id}-${this.mode}`;
                currentFileIds.add(fileId);
                if (!(fileId in existingFiles)) {
                    newVideos.push(video);
                }
            }

            const progressBar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
            progressBar.start(newVideos.length, 0);

            for (const video of newVideos) {
                const fileId = `youtube-channel-${this.channelId}-${video.id}-${this.mode}`;
                let content: string;
                switch (this.mode) {
                    case 'metadata':
                        content = await this.getMetadataContent(video);
                        break;
                    case 'thumbnail':
                        content = this.getThumbnailContent(video);
                        break;
                    case 'transcript':
                        content = await this.getTranscriptContent(video);
                        break;
                    case 'video':
                        content = this.getVideoContent(video.id!);
                        break;
                    case 'audio':
                        content = this.getAudioContent(video.id!);
                        break;
                    default:
                        throw new Error(`Invalid mode: ${this.mode}`);
                }
                updates[fileId] = { action: 'add', content };
                progressBar.increment();
            }
            progressBar.stop();

            if (!this.noDelete) {
                for (const fileId in existingFiles) {
                    if (!currentFileIds.has(fileId)) {
                        updates[fileId] = { action: 'delete' };
                    }
                }
            }

            return updates;
        } catch (error) {
            console.error('Error in update:', error);
            return {};
        }
    }
}