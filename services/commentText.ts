export const MAX_COMMENT_TEXT_LENGTH = 2000;
export const MAX_AUDIO_LIVE_COMMENT_LENGTH = 200;

type PrepareCommentTextOptions = {
  rawText: unknown;
  hasAudio?: boolean;
  maxLength?: number;
  emptyMessage?: string;
  tooLongMessage?: string;
  preserveAudioOnlyPlaceholder?: boolean;
};

type PrepareCommentTextResult =
  | {
      ok: true;
      normalizedText: string;
      storedText: string;
      message?: string;
    }
  | {
      ok: false;
      normalizedText: string;
      storedText: string;
      message: string;
    };

export const normalizeCommentText = (value: unknown): string => {
  return typeof value === "string" ? value.trim() : "";
};

export const prepareCommentText = ({
  rawText,
  hasAudio = false,
  maxLength = MAX_COMMENT_TEXT_LENGTH,
  emptyMessage = "Comment cannot be empty",
  tooLongMessage = `Comment is too long (max ${maxLength} characters)`,
  preserveAudioOnlyPlaceholder = false,
}: PrepareCommentTextOptions): PrepareCommentTextResult => {
  const normalizedText = normalizeCommentText(rawText);

  if (!normalizedText && !hasAudio) {
    return {
      ok: false,
      normalizedText,
      storedText: normalizedText,
      message: emptyMessage,
    };
  }

  if (normalizedText.length > maxLength) {
    return {
      ok: false,
      normalizedText,
      storedText: normalizedText,
      message: tooLongMessage,
    };
  }

  return {
    ok: true,
    normalizedText,
    storedText:
      !normalizedText && hasAudio && preserveAudioOnlyPlaceholder
        ? " "
        : normalizedText,
  };
};
