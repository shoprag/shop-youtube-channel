import { Shop, JsonObject } from '@shoprag/core';
import { google } from 'googleapis';
import { YoutubeTranscript } from 'youtube-transcript';
import moment from 'moment';

/**
 * YouTube Channel Shop plugin for ShopRAG.
 * Fetches data from a YouTube channel based on filters and delivers it in one of five modes.
 */
export default class YouTubeChannelShop implements Shop {
    private youtube: any; // YouTube API client
    private channelId: string; // YouTube channel ID
    private mode: string; // Operation mode
    private filters: {
        titleIncludes?: RegExp;
        durationMoreThan?: number;
        durationLessThan?: number;
        dropAfter?: string;
        startDate?: string;
    }; // Filter settings

    /**
     * Defines the credentials required by this Shop.
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
     * @param credentials User-provided credentials.
     * @param config Configuration from shoprag.json.
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
        this.channelId = config['channelId'] as string;
        if (!this.channelId) {
            throw new Error('channelId is required in config.');
        }
        this.mode = (config['mode'] as string) || 'metadata';
        this.filters = {
            titleIncludes: config['titleIncludes'] ? new RegExp(config['titleIncludes'] as string) : undefined,
            durationMoreThan: config['durationMoreThan']
                ? parseInt(config['durationMoreThan'] as string, 10)
                : undefined,
            durationLessThan: config['durationLessThan']
                ? parseInt(config['durationLessThan'] as string, 10)
                : undefined,
            dropAfter: config['dropAfter'] as string,
            startDate: config['startDate'] as string
        };
    }

    /**
     * Fetches all video IDs from the channel.
     * @returns Array of video IDs.
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
            videoIds.push(...response.data.items.map((item: any) => item.id.videoId));
            nextPageToken = response.data.nextPageToken;
        } while (nextPageToken);
        return videoIds;
    }

    /**
     * Fetches detailed video information in batches.
     * @returns Array of video details.
     */
    private async getAllVideoDetails(): Promise<any[]> {
        const videoIds = await this.getChannelVideoIds();
        const details: any[] = [];
        for (let i = 0; i < videoIds.length; i += 50) {
            const batch = videoIds.slice(i, i + 50);
            const response = await this.youtube.videos.list({
                part: ['contentDetails', 'snippet'],
                id: batch.join(',')
            });
            details.push(...response.data.items);
        }
        return details;
    }

    /**
     * Applies filters to the video list.
     * @param videos List of video details.
     * @returns Filtered list of videos.
     */
    private applyFilters(videos: any[]): any[] {
        return videos.filter((video) => {
            const title = video.snippet.title;
            const publishedAt = new Date(video.snippet.publishedAt);
            const duration = this.parseDuration(video.contentDetails.duration);

            if (this.filters.titleIncludes && !this.filters.titleIncludes.test(title)) {
                return false;
            }
            if (this.filters.startDate && publishedAt < new Date(this.filters.startDate)) {
                return false;
            }
            if (this.filters.durationMoreThan && duration < this.filters.durationMoreThan) {
                return false;
            }
            if (this.filters.durationLessThan && duration > this.filters.durationLessThan) {
                return false;
            }
            if (this.filters.dropAfter && this.shouldDropVideo(video.snippet.publishedAt)) {
                return false;
            }
            return true;
        });
    }

    /**
     * Parses ISO 8601 duration (e.g., PT1H2M3S) to seconds.
     * @param duration Duration string.
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
     * Determines if a video should be dropped based on age.
     * @param publishedAt Publication date string.
     * @returns True if video exceeds dropAfter duration.
     */
    private shouldDropVideo(publishedAt: string): boolean {
        if (!this.filters.dropAfter) return false;
        const age = moment.duration(moment().diff(moment(publishedAt)));
        const dropDuration = this.parseDropAfter(this.filters.dropAfter);
        return age.asMilliseconds() > dropDuration;
    }

    /**
     * Parses dropAfter duration (e.g., "1y") to milliseconds.
     * @param dropAfter Duration string.
     * @returns Duration in milliseconds.
     */
    private parseDropAfter(dropAfter: string): number {
        const unit = dropAfter.slice(-1);
        const value = parseInt(dropAfter.slice(0, -1), 10);
        switch (unit) {
            case 'd':
                return value * 24 * 60 * 60 * 1000; // days
            case 'w':
                return value * 7 * 24 * 60 * 60 * 1000; // weeks
            case 'm':
                return value * 30 * 24 * 60 * 60 * 1000; // months (approx)
            case 'y':
                return value * 365 * 24 * 60 * 60 * 1000; // years (approx)
            default:
                throw new Error(`Invalid dropAfter unit: ${unit}`);
        }
    }

    /**
     * Fetches metadata content for a video.
     * @param video Video details.
     * @returns JSON string of metadata.
     */
    private async getMetadataContent(video: any): Promise<string> {
        return JSON.stringify(video.snippet);
    }

    /**
     * Fetches thumbnail URL for a video.
     * @param video Video details.
     * @returns Thumbnail URL.
     */
    private getThumbnailContent(video: any): string {
        return video.snippet.thumbnails.high.url;
    }

    /**
     * Fetches transcript for a video.
     * @param videoId Video ID.
     * @returns Transcript text or error message.
     */
    private async getTranscriptContent(videoId: string): Promise<string> {
        try {
            const transcript = await YoutubeTranscript.fetchTranscript(videoId);
            return transcript.map((t: any) => t.text).join(' ');
        } catch (error) {
            console.error(`Failed to fetch transcript for ${videoId}:`, error);
            return 'Transcript not available';
        }
    }

    /**
     * Provides video URL.
     * @param videoId Video ID.
     * @returns YouTube video URL.
     */
    private getVideoContent(videoId: string): string {
        return `https://www.youtube.com/watch?v=${videoId}`;
    }

    /**
     * Placeholder for audio content (not implemented).
     * @param videoId Video ID.
     * @returns Placeholder message.
     */
    private getAudioContent(videoId: string): string {
        return 'Audio extraction not implemented';
    }

    /**
     * Generates updates by comparing current videos with existing files.
     * @param lastUsed Last run timestamp.
     * @param existingFiles Files previously contributed by this Shop.
     * @returns Dictionary of file updates.
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

            // Process current videos
            for (const video of filteredVideos) {
                const fileId = `youtube-channel-${this.channelId}-${video.id}-${this.mode}`;
                currentFileIds.add(fileId);

                if (!(fileId in existingFiles)) {
                    let content: string;
                    switch (this.mode) {
                        case 'metadata':
                            content = await this.getMetadataContent(video);
                            break;
                        case 'thumbnail':
                            content = this.getThumbnailContent(video);
                            break;
                        case 'transcript':
                            content = await this.getTranscriptContent(video.id);
                            break;
                        case 'video':
                            content = this.getVideoContent(video.id);
                            break;
                        case 'audio':
                            content = this.getAudioContent(video.id);
                            break;
                        default:
                            throw new Error(`Invalid mode: ${this.mode}`);
                    }
                    updates[fileId] = { action: 'add', content };
                }
                // Note: YouTube videos don't typically "update" after publishing,
                // so we only add new videos and delete old ones.
            }

            // Detect deletions
            for (const fileId in existingFiles) {
                if (!currentFileIds.has(fileId)) {
                    updates[fileId] = { action: 'delete' };
                }
            }

            return updates;
        } catch (error) {
            console.error('Error in update:', error);
            return {};
        }
    }
}