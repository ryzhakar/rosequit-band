const STREAMING_SERVICE_PICKER_ADDRESS = "https://song.link/";
const INSTAGRAM_PROFILE_ADDRESS = "https://www.instagram.com/";
const PAGE_CONTENT_FILE = "page_content.yaml";
const INTERFACE_TEXT_FILE = "interface_text.yaml";

const PICKER_REACHABILITY_TIMEOUT_MILLISECONDS = 3000;
const DIRECT_ADDRESS_ATTRIBUTE = "data-direct-address";
const TRACKING_PARAMETER_NAMES = ["si", "feature"];
const TRACKING_PARAMETER_PREFIX = "utm_";

const HTML_LANGUAGE_CODES = { ukrainian: "uk", english: "en" };
const FALLBACK_LANGUAGE = "ukrainian";
const LANGUAGE_STORAGE_KEY = "rosequit-language";
const BROWSER_LANGUAGE_PREFIXES_SHOWN_IN_UKRAINIAN = ["uk", "ru"];
const PAGE_CONTENT_FAILED_CLASS = "page-content-failed";

const SPOTIFY_ADDRESS_PREFIX = "https://open.spotify.com/";
const SPOTIFY_COVER_LOOKUP_ADDRESS = "https://open.spotify.com/oembed?url=";
const SPOTIFY_SMALL_COVER_SIZE_CODE = "00001e02";
const SPOTIFY_LARGE_COVER_SIZE_CODE = "0000b273";
const COVER_CACHE_KEY_PREFIX = "rosequit-cover:";
const COVER_CACHE_LIFETIME_DAYS = 30;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const LOAD_WHEN_NEAR_THE_SCREEN = "lazy";
const LOAD_IMMEDIATELY = "eager";
const COVER_LOADED_CLASS = "cover-loaded";

const byId = (id) => document.getElementById(id);

const page = {
  bandDescription: byId("band-description"),
  featuredRelease: byId("featured-release"),
  lyricVideosSection: byId("lyric-videos-section"),
  lyricVideosHeading: byId("lyric-videos-heading"),
  lyricVideosList: byId("lyric-videos-list"),
  songsSection: byId("songs-section"),
  songsHeading: byId("songs-heading"),
  songsHint: byId("songs-hint"),
  songsList: byId("songs-list"),
  instagramLink: byId("instagram-link"),
  instagramName: byId("instagram-name"),
  instagramUsername: byId("instagram-username"),
  fallbackListenButton: byId("fallback-listen-button"),
  languageButtons: document.querySelectorAll("[data-language]"),
};

const coverAddressRequests = new Map();

let pageContent;
let interfaceText;
let currentLanguage;
let streamingServicePickerIsKnownToBeDown = false;

function rememberLanguageIfPossible(language) {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    return;
  }
}

function readRememberedLanguage() {
  try {
    return localStorage.getItem(LANGUAGE_STORAGE_KEY);
  } catch {
    return null;
  }
}

function isSupportedLanguage(language) {
  return language in HTML_LANGUAGE_CODES;
}

function languageFromBrowserSettings() {
  const browserLanguages = navigator.languages || [navigator.language || ""];
  const readsUkrainian = browserLanguages.some((browserLanguage) =>
    BROWSER_LANGUAGE_PREFIXES_SHOWN_IN_UKRAINIAN.some((prefix) => browserLanguage.toLowerCase().startsWith(prefix)),
  );
  return readsUkrainian ? "ukrainian" : "english";
}

function chooseInitialLanguage() {
  const rememberedLanguage = readRememberedLanguage();
  return isSupportedLanguage(rememberedLanguage) ? rememberedLanguage : languageFromBrowserSettings();
}

function translated(copiesByLanguage) {
  if (!copiesByLanguage) return "";
  return copiesByLanguage[currentLanguage] || copiesByLanguage[FALLBACK_LANGUAGE] || "";
}

function interfaceTextFor(key) {
  return translated(interfaceText[key]);
}

function fillIn(template, valuesByName) {
  return Object.entries(valuesByName).reduce(
    (filledText, [name, value]) => filledText.replaceAll(`{${name}}`, value),
    template,
  );
}

function createElementWithText(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function withoutTrackingParameters(address) {
  const cleanedAddress = new URL(address);
  for (const name of [...cleanedAddress.searchParams.keys()]) {
    const isTracking = TRACKING_PARAMETER_NAMES.includes(name) || name.startsWith(TRACKING_PARAMETER_PREFIX);
    if (isTracking) cleanedAddress.searchParams.delete(name);
  }
  return cleanedAddress.toString();
}

function throughStreamingServicePicker(address) {
  return STREAMING_SERVICE_PICKER_ADDRESS + withoutTrackingParameters(address);
}

function pointLinkAtStreamingServicePicker(link, address) {
  link.href = throughStreamingServicePicker(address);
  link.setAttribute(DIRECT_ADDRESS_ATTRIBUTE, withoutTrackingParameters(address));
}

function probeAddressWithTimeout(address, timeoutMilliseconds) {
  const cancellation = new AbortController();
  const timer = setTimeout(() => cancellation.abort(), timeoutMilliseconds);
  return fetch(address, { method: "HEAD", mode: "no-cors", cache: "no-store", signal: cancellation.signal })
    .finally(() => clearTimeout(timer));
}

async function isStreamingServicePickerReachable() {
  try {
    await probeAddressWithTimeout(STREAMING_SERVICE_PICKER_ADDRESS, PICKER_REACHABILITY_TIMEOUT_MILLISECONDS);
    return true;
  } catch {
    return false;
  }
}

function sendAllLinksDirectlyToTheirServices() {
  for (const link of document.querySelectorAll(`[${DIRECT_ADDRESS_ATTRIBUTE}]`)) {
    link.href = link.getAttribute(DIRECT_ADDRESS_ATTRIBUTE);
  }
}

function sendLinksDirectlyWhenPickerIsKnownToBeDown() {
  if (streamingServicePickerIsKnownToBeDown) sendAllLinksDirectlyToTheirServices();
}

async function learnWhetherPickerIsDown() {
  streamingServicePickerIsKnownToBeDown = !(await isStreamingServicePickerReachable());
  sendLinksDirectlyWhenPickerIsKnownToBeDown();
}

function isSpotifyAddress(address) {
  return address.startsWith(SPOTIFY_ADDRESS_PREFIX);
}

function readCachedCoverAddress(listenLink) {
  try {
    const cached = JSON.parse(localStorage.getItem(COVER_CACHE_KEY_PREFIX + listenLink));
    const cacheLifetimeMilliseconds = COVER_CACHE_LIFETIME_DAYS * MILLISECONDS_PER_DAY;
    const isStillFresh = cached && Date.now() - cached.savedAt < cacheLifetimeMilliseconds;
    return isStillFresh ? cached.address : null;
  } catch {
    return null;
  }
}

function cacheCoverAddressIfPossible(listenLink, address) {
  try {
    localStorage.setItem(COVER_CACHE_KEY_PREFIX + listenLink, JSON.stringify({ address, savedAt: Date.now() }));
  } catch {
    return;
  }
}

async function lookUpCoverAddressOnSpotify(listenLink) {
  const response = await fetch(SPOTIFY_COVER_LOOKUP_ADDRESS + encodeURIComponent(listenLink));
  if (!response.ok) throw new Error(`Spotify cover lookup answered ${response.status}`);
  return (await response.json()).thumbnail_url;
}

async function findCoverAddress(listenLink) {
  const cachedAddress = readCachedCoverAddress(listenLink);
  if (cachedAddress) return cachedAddress;
  try {
    const address = await lookUpCoverAddressOnSpotify(listenLink);
    cacheCoverAddressIfPossible(listenLink, address);
    return address;
  } catch {
    return null;
  }
}

function coverAddressFor(listenLink) {
  if (!isSpotifyAddress(listenLink)) return Promise.resolve(null);
  if (!coverAddressRequests.has(listenLink)) coverAddressRequests.set(listenLink, findCoverAddress(listenLink));
  return coverAddressRequests.get(listenLink);
}

function createCoverImage(address, loadingMode) {
  const image = document.createElement("img");
  image.alt = "";
  image.loading = loadingMode;
  image.addEventListener("load", () => image.classList.add(COVER_LOADED_CLASS));
  image.addEventListener("error", () => image.remove());
  image.src = address;
  return image;
}

function showCoverInside(frame, { release, sizeCode, loadingMode }) {
  frame.append(createElementWithText("span", "cover-initial", release.title[0]));
  coverAddressFor(release.listen_link).then((coverAddress) => {
    if (!coverAddress) return;
    frame.append(createCoverImage(coverAddress.replace(SPOTIFY_SMALL_COVER_SIZE_CODE, sizeCode), loadingMode));
  });
}

function isCompleteRelease(release) {
  return Boolean(release && release.title && release.release_year && release.listen_link);
}

function sortNewestFirst(releases) {
  return [...releases].sort((first, second) => Number(second.release_year) - Number(first.release_year));
}

function createRow({ release, address, kind, accessibleLabel }) {
  const link = createElementWithText("a", `row ${kind}`);
  pointLinkAtStreamingServicePicker(link, address);
  link.setAttribute("aria-label", accessibleLabel);

  const coverFrame = createElementWithText("span", "cover-frame");
  showCoverInside(coverFrame, { release, sizeCode: SPOTIFY_SMALL_COVER_SIZE_CODE, loadingMode: LOAD_WHEN_NEAR_THE_SCREEN });

  const nameAndYear = createElementWithText("span", "name-and-year");
  nameAndYear.append(createElementWithText("span", "title", release.title));
  nameAndYear.append(createElementWithText("span", "year", String(release.release_year)));

  link.append(coverFrame, nameAndYear);
  const item = createElementWithText("li");
  item.append(link);
  return item;
}

function createSongRow(song) {
  return createRow({
    release: song,
    address: song.listen_link,
    kind: "song-row",
    accessibleLabel: fillIn(interfaceTextFor("listen_to_release_for_screen_readers"), { title: song.title }),
  });
}

function createLyricVideoRow(song) {
  return createRow({
    release: song,
    address: song.optional_lyric_video_link,
    kind: "video-row",
    accessibleLabel: fillIn(interfaceTextFor("watch_lyric_video_for_screen_readers"), { title: song.title }),
  });
}

function warnAboutIncompleteSong(song) {
  console.warn("Song skipped: it needs a title, a release_year and a listen_link", song);
}

function completeSongsNewestFirst() {
  const songs = pageContent.songs || [];
  songs.filter((song) => !isCompleteRelease(song)).forEach(warnAboutIncompleteSong);
  return sortNewestFirst(songs.filter(isCompleteRelease));
}

function releaseDetailsLine(release) {
  const trackCount = release.optional_track_count
    ? fillIn(interfaceTextFor("album_track_count"), { count: String(release.optional_track_count) })
    : "";
  return [release.release_year, trackCount].filter(Boolean).join(" · ");
}

function showLanguageSwitchState() {
  document.documentElement.lang = HTML_LANGUAGE_CODES[currentLanguage];
  for (const button of page.languageButtons) {
    button.setAttribute("aria-pressed", String(button.dataset.language === currentLanguage));
  }
}

function showBandDescription() {
  page.bandDescription.textContent = translated(pageContent.band && pageContent.band.optional_description);
}

function showFeaturedRelease() {
  const release = pageContent.featured_release;
  if (!isCompleteRelease(release)) throw new Error("featured_release needs a title, a release_year and a listen_link");

  const coverLink = createElementWithText("a", "featured-cover");
  pointLinkAtStreamingServicePicker(coverLink, release.listen_link);
  coverLink.setAttribute("aria-label", fillIn(interfaceTextFor("listen_to_release_for_screen_readers"), { title: release.title }));
  showCoverInside(coverLink, { release, sizeCode: SPOTIFY_LARGE_COVER_SIZE_CODE, loadingMode: LOAD_IMMEDIATELY });

  const kind = createElementWithText("p", "kind", translated(release.optional_kind));
  const title = createElementWithText("h2", "", release.title);
  const details = createElementWithText("p", "details", releaseDetailsLine(release));

  const listenButton = createElementWithText("a", "button", interfaceTextFor("album_listen_button"));
  pointLinkAtStreamingServicePicker(listenButton, release.listen_link);

  page.featuredRelease.replaceChildren(coverLink, kind, title, details, listenButton);
  page.featuredRelease.hidden = false;
}

function showLyricVideos() {
  const songsWithLyricVideo = completeSongsNewestFirst().filter((song) => song.optional_lyric_video_link);
  page.lyricVideosHeading.textContent = interfaceTextFor("lyric_videos_heading");
  page.lyricVideosList.replaceChildren(...songsWithLyricVideo.map(createLyricVideoRow));
  page.lyricVideosSection.hidden = songsWithLyricVideo.length === 0;
}

function showSongs() {
  const songs = completeSongsNewestFirst();
  page.songsHeading.textContent = interfaceTextFor("songs_heading");
  page.songsHint.textContent = interfaceTextFor("songs_hint");
  page.songsList.replaceChildren(...songs.map(createSongRow));
  page.songsSection.hidden = songs.length === 0;
}

function showInstagramLink() {
  const username = pageContent.band && pageContent.band.optional_instagram_username;
  if (!username) return;
  page.instagramLink.href = INSTAGRAM_PROFILE_ADDRESS + username + "/";
  page.instagramName.textContent = interfaceTextFor("instagram_name");
  page.instagramUsername.textContent = "@" + username;
  page.instagramLink.hidden = false;
}

function renderPage() {
  showLanguageSwitchState();
  showBandDescription();
  showFeaturedRelease();
  showLyricVideos();
  showSongs();
  showInstagramLink();
  sendLinksDirectlyWhenPickerIsKnownToBeDown();
}

function chooseLanguage(language) {
  currentLanguage = language;
  rememberLanguageIfPossible(language);
  renderPage();
}

function listenForLanguageChoices() {
  for (const button of page.languageButtons) {
    button.addEventListener("click", () => chooseLanguage(button.dataset.language));
  }
}

async function loadYaml(file) {
  const response = await fetch(file, { cache: "no-cache" });
  if (!response.ok) throw new Error(`${file} answered ${response.status}`);
  return jsyaml.load(await response.text());
}

async function startPage() {
  [pageContent, interfaceText] = await Promise.all([loadYaml(PAGE_CONTENT_FILE), loadYaml(INTERFACE_TEXT_FILE)]);
  currentLanguage = chooseInitialLanguage();
  listenForLanguageChoices();
  renderPage();
  page.fallbackListenButton.hidden = true;
  learnWhetherPickerIsDown();
}

function showFailedPage(problem) {
  console.error(problem);
  document.documentElement.classList.add(PAGE_CONTENT_FAILED_CLASS);
}

startPage().catch(showFailedPage);
