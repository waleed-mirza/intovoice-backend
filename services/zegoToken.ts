// eslint-disable-next-line @typescript-eslint/no-var-requires
const { generateToken04 } = require("./zego/zegoServerAssistant");

const TOKEN_TTL_SECONDS = 3600;

type LiveTokenRole = "host" | "audience";

const getZegoConfig = () => {
  const appId = parseInt(process.env.ZEGO_APP_ID || "", 10);
  const serverSecret = process.env.ZEGO_SERVER_SECRET || "";

  if (!appId || Number.isNaN(appId)) {
    throw new Error("ZEGO_APP_ID is not configured");
  }
  if (!serverSecret || serverSecret.length !== 32) {
    throw new Error("ZEGO_SERVER_SECRET must be a 32-byte string");
  }

  return { appId, serverSecret };
};

export const generateLiveToken = (
  userId: string,
  roomId: string,
  role: LiveTokenRole
) => {
  const { appId, serverSecret } = getZegoConfig();

  const payloadObject = {
    room_id: roomId,
    privilege: {
      1: 1,
      2: role === "host" ? 1 : 0,
    },
    stream_id_list: null,
  };

  const payload = JSON.stringify(payloadObject);
  const token = generateToken04(
    appId,
    userId,
    serverSecret,
    TOKEN_TTL_SECONDS,
    payload
  );

  if (token?.errorCode) {
    throw new Error(token.errorMessage || "Failed to generate Zego token");
  }

  return {
    token,
    appId,
    expiresIn: TOKEN_TTL_SECONDS,
  };
};
