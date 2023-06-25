/* eslint-disable @typescript-eslint/no-explicit-any */

interface SpotifyTrack {
  artist: string;
  duration: number;
  name: string;
  previewUrl: string;
  uri: string;
}

interface Spotify {
  getTracks: (url: string) => Promise<SpotifyTrack[]>;
}

declare module "spotify-url-info" {
  function spotify(fetch: any): Spotify;
  export = spotify;
}
