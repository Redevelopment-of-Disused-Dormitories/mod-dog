/* mod dog — config.js
   在此填入你的 Twitch / YouTube 開發者憑證。
   請勿將此檔案上傳至公開倉庫。 */

export default {
  twitch: {
    clientId: '',
    clientSecret: '',
    redirectUri: 'http://localhost:3000/auth/twitch/callback',
    scopes: 'chat:read chat:edit moderator:manage:banned_users moderator:manage:chat_settings channel:moderate',
  },
  youtube: {
    clientId: '',
    clientSecret: '',
    redirectUri: 'http://localhost:3000/auth/youtube/callback',
    scopes: 'https://www.googleapis.com/auth/youtube https://www.googleapis.com/auth/youtube.force-ssl',
  },
};
