/**
 * Which data source the app uses.
 * - live (default): the Arterial API over REST and Server-Sent Events.
 * - fixtures: hand-written design fixtures, only in development or with
 *   `--mode fixtures`, always behind a visible banner.
 */
export const USE_FIXTURES = import.meta.env.MODE === 'fixtures' || import.meta.env.VITE_DATA_SOURCE === 'fixtures';

export const API_URL = (import.meta.env.VITE_API_URL ?? '').trim();
