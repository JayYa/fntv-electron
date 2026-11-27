export interface LoginData {
    app_name: string;
    username: string;
    password: string;
}

export interface SetSkipInfoData {
    guid: string;
    skip_opening: number;
    skip_ending: number;
}

export interface PlayInfoData {
    item_guid: string;
    media_guid?: string;
    audio_guid?: string;
    subtitle_guid?: string;
    video_guid?: string;
}

export interface SubtitleStream {
    guid: string;
    format: string;
    title: string;
}

export interface SubtitleResponse {
    subtitle_streams?: SubtitleStream[];
}

export interface Subtitle {
    id: string;
    format: string;
    name: string;
}

export type SubtitleDownloadStatus = 'downloaded' | 'skipped' | 'failed';

export interface SubtitleDownloadResult {
    id: string;
    filePath: string;
    status: SubtitleDownloadStatus;
    error?: string;
}

export interface UserInfo {
    [key: string]: any;
}

export interface PlayInfo {
    grand_guid: string;
    guid: string;
    parent_guid: string;
    play_config: {
        skip_opening: number | null;
        skip_ending: number | null;
    };
    ts: number;
    type: string;
    video_guid: string;
    audio_guid: string;
    subtitle_guid: string;
    media_guid: string;
    item: {
        guid: string;
        trim_id: string;
        tv_title: string;
        parent_title: string;
        title: string;
        posters: string;
        poster_width: number;
        poster_height: number;
        vote_average: string;
        runtime: number;
        overview: string;
        is_favorite: number;
        is_watched: number;
        watched_ts: number;
        still_path: string;
        air_date: string;
        season_number: number;
        episode_number: number;
        number_of_seasons: number;
        number_of_episodes: number;
        local_number_of_episodes: number;
        local_number_of_seasons: number;
        can_play: number;
        type: string;
        play_error: string;
        parent_guid: string;
        ancestor_name: string;
        play_item_guid: string;
        duration: number;
        logic_type: number;
    };
}

export interface WatchedData {
    item_guid: string;
}

export interface PlayRecord {
    item_guid: string;
    media_guid: string;
    video_guid: string;
    audio_guid: string;
    subtitle_guid: string;
    play_link: string;
    ts: number;
    duration: number;
}

export interface MediaStream {
    resolutions: string[] | null;
    audio_type: string | null;
    color_range_type: string | null;
}

export interface PlayQualityItem {
    bitrate: number;
    resolution: string;
    progressive: boolean;
}

export type PlayQualityResponse = PlayQualityItem[];

export interface PlayInfoDataExtended {
    audio_guid: string;
    item_guid: string;
    media_guid: string;
    subtitle_guid: string;
    video_guid: string;
}

export interface FileInfo {
    guid: string;
    path: string;
    size: number;
    timestamp: number;
    type: number;
    can_play: number;
    play_error: string;
    create_time: number;
    update_time: number;
    file_birth_time: number;
    progress_thumb_hash_dir: string;
}

export interface VideoStream {
    media_guid: string;
    title: string;
    guid: string;
    resolution_type: string;
    color_range_type: string;
    codec_name: string;
    codec_type: string;
    color_range: string;
    profile: string;
    index: number;
    width: number;
    height: number;
    coded_width: number;
    coded_height: number;
    display_aspect_ratio: string;
    pix_fmt: string;
    level: number;
    color_space: string;
    color_transfer: string;
    color_primaries: string;
    duration: number;
    dv_profile: number;
    refs: number;
    r_frame_rate: string;
    avg_frame_rate: string;
    bits_per_raw_sample: string;
    bps: number;
    progressive: number;
    bit_depth: number;
    wrapper: string;
    create_time: number;
    update_time: number;
    rotation: number;
    ext1: number;
    is_bluray: boolean;
}

export interface AudioStream {
    media_guid: string;
    title: string;
    guid: string;
    audio_type: string;
    codec_name: string;
    codec_type: string;
    language: string;
    channels: number;
    profile: string;
    sample_rate: string;
    is_default: number;
    channel_layout: string;
    duration: number;
    index: number;
    bits_per_raw_sample: string;
    bps: number;
    create_time: number;
    update_time: number;
    is_fake: boolean;
}

export interface SubtitleStreamExtended {
    media_guid: string;
    title: string;
    guid: string;
    codec_name: string;
    codec_type: string;
    language: string;
    forced: number;
    index: number;
    is_default: number;
    is_external: number;
    format: string;
    trim_id: string;
    source_id: string;
    Source: string;
    create_time: number;
    update_time: number;
    extra_file: number;
    is_bitmap: number;
    file_size: number;
}

export interface PlayListItem {
    guid: string;
    lan: string;
    douban_id: number;
    imdb_id: string;
    trim_id: string;
    tv_title: string;
    parent_guid: string;
    parent_title: string;
    title: string;
    type: string;
    poster: string;
    poster_width: number;
    poster_height: number;
    runtime: number;
    is_favorite: number;
    watched: number;
    watched_ts: number;
    vote_average: string;
    media_stream: MediaStream;
    season_number: number;
    episode_number: number;
    air_date: string;
    number_of_seasons: number;
    number_of_episodes: number;
    local_number_of_seasons: number;
    local_number_of_episodes: number;
    status: string;
    overview: string;
    ancestor_guid: string;
    ancestor_name: string;
    ancestor_category: string;
    ts: number;
    duration: number;
    single_child_guid: string;
    video_guid: string;
    file_name: string;
}

export interface StreamListResponse {
    files: FileInfo[];
    video_streams: VideoStream[];
    audio_streams: AudioStream[];
    subtitle_streams: SubtitleStreamExtended[];
}

export interface StreamRequestData {
    header: {
        "User-Agent": string[];
    };
    level: number;
    media_guid: string;
    ip: string;
}

export interface Quality {
    bitrate: number;
    resolution: string;
    progressive: boolean;
    is_m3u8: boolean;
}

export interface CloudStorageInfo {
    dav_username: string;
    valid: boolean;
    disabled: boolean;
    cloud_storage_type: number;
    cloud_nick_name: string;
    fssize: number;
    frsize: number;
    fusize: number;
    is_vip: boolean;
    quark_vip_type: string;
    quark_pc_pay_link: string;
    quark_wap_pay_link: string;
}

export interface DirectLinkQuality {
    bitrate: number;
    resolution: string;
    progressive: boolean;
    url: string;
    is_m3u8: boolean;
    expired_at: number;
}

export interface DirectLinkAudioStream {
    media_guid: string;
    title: string;
    guid: string;
    audio_type: string;
    codec_name: string;
    codec_type: string;
    language: string;
    channels: number;
    profile: string;
    sample_rate: string;
    is_default: boolean;
    channel_layout: string;
    duration: number;
    index: number;
    bits_per_raw_sample: string;
    bps: number;
    create_time: number;
    update_time: number;
    is_fake: boolean;
}

export interface StreamResponse {
    file_stream: FileInfo;
    video_stream: VideoStream;
    audio_streams: AudioStream[];
    subtitle_streams: SubtitleStreamExtended[];
    qualities: Quality[];
    cloud_storage_info: CloudStorageInfo | null;
    header: {
        Cookie: string[] | null;
        'User-Agent'?: string[] | null;
    };
    direct_link_qualities: DirectLinkQuality[];
    direct_link_audio_streams: DirectLinkAudioStream[];
}

export interface ItemListRequest {
    parent_guid: string;
    exclude_folder: number;
    sort_column: string;
    sort_type: string;
}

export interface ItemListResponse {
    mdb_name: string;
    mdb_category: string;
    top_dir: string;
    dir: string;
    total: number;
    list: PlayListItem[];
}

export interface SysConfigResponse {
    nas_oauth: {
        app_id: string;
        url: string;
    };
}

export interface AuthRequest {
    source: string;
    code: string;
}

export interface AuthResponse {
    token: string;
}

export interface LoginResponse {
    token: string;
}
