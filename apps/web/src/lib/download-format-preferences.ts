import type { DownloadType } from "@vidbee/downloader-core";
import {
	buildAudioFormatPreference as buildSharedAudioFormatPreference,
	buildVideoFormatPreference as buildSharedVideoFormatPreference,
	type OneClickContainerOption,
	type OneClickQualityPreset,
} from "@vidbee/downloader-core/format-preferences";

export type { OneClickContainerOption, OneClickQualityPreset };

export interface WebDownloadSettings {
	oneClickDownload: boolean;
	oneClickDownloadType: DownloadType;
	oneClickQuality: OneClickQualityPreset;
	oneClickContainer: OneClickContainerOption;
}

export const DEFAULT_WEB_DOWNLOAD_SETTINGS: WebDownloadSettings = {
	oneClickDownload: true,
	oneClickDownloadType: "video",
	oneClickQuality: "best",
	oneClickContainer: "auto",
};

export const buildVideoFormatPreference = (
	settings: WebDownloadSettings,
): string =>
	buildSharedVideoFormatPreference({
		oneClickQuality: settings.oneClickQuality,
	});

export const buildAudioFormatPreference = (
	settings: WebDownloadSettings,
): string =>
	buildSharedAudioFormatPreference({
		oneClickQuality: settings.oneClickQuality,
	});
