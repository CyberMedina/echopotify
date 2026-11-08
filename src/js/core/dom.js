/* ==========================================================================
   CORE: Centralized DOM References & Theme Helpers
   ========================================================================== */
'use strict';

// --------------------------------------------------------------------------
// 2. DOM REFERENCES
// --------------------------------------------------------------------------
const root = document.documentElement;

function applyNeutralLikedTheme() {
  document.body.classList.remove('album-dark-active', 'album-light-active');
  const isDark = document.body.classList.contains('theme-dark');
  if (isDark) {
    root.style.setProperty('--album-fg-primary', '#ffffff');
    root.style.setProperty('--album-fg-secondary', 'rgba(255, 255, 255, 0.72)');
    root.style.setProperty('--album-fg-muted', 'rgba(255, 255, 255, 0.48)');
    root.style.setProperty('--album-hairline', 'rgba(255, 255, 255, 0.10)');
    root.style.setProperty('--album-play-bg', '#1db954');
    root.style.setProperty('--album-play-fg', '#ffffff');
    root.style.setProperty('--album-circle-bg', 'rgba(255, 255, 255, 0.14)');
    root.style.setProperty('--album-circle-fg', '#ffffff');
    root.style.setProperty('--album-row-hover', 'rgba(255, 255, 255, 0.08)');
    root.style.setProperty('--album-row-active', 'rgba(255, 255, 255, 0.15)');
    root.style.setProperty('--album-cover-shadow', 'rgba(69, 10, 245, 0.35)');
  } else {
    root.style.setProperty('--album-fg-primary', '#111214');
    root.style.setProperty('--album-fg-secondary', 'rgba(17, 18, 20, 0.70)');
    root.style.setProperty('--album-fg-muted', 'rgba(17, 18, 20, 0.50)');
    root.style.setProperty('--album-hairline', 'rgba(17, 18, 20, 0.10)');
    root.style.setProperty('--album-play-bg', '#1db954');
    root.style.setProperty('--album-play-fg', '#ffffff');
    root.style.setProperty('--album-circle-bg', 'rgba(17, 18, 20, 0.08)');
    root.style.setProperty('--album-circle-fg', '#111214');
    root.style.setProperty('--album-row-hover', 'rgba(17, 18, 20, 0.05)');
    root.style.setProperty('--album-row-active', 'rgba(17, 18, 20, 0.10)');
    root.style.setProperty('--album-cover-shadow', 'rgba(69, 10, 245, 0.22)');
  }
}
const echoViewport = document.getElementById('echoViewport');
const nowPlayingOverlay = document.getElementById('nowPlayingOverlay');
const miniPlayer = document.getElementById('miniPlayer');
const miniPlayerLeft = document.querySelector('#miniPlayer .mini-player-left');
const miniPlayerThumb = document.getElementById('miniPlayerThumb');
const miniPlayerTitle = document.getElementById('miniPlayerTitle');
const miniPlayerArtist = document.getElementById('miniPlayerArtist');
const miniPlayPauseBtn = document.getElementById('miniPlayPauseBtn');
const miniNextBtn = document.getElementById('miniNextBtn');
const miniLikeBtn = document.getElementById('miniLikeBtn');

const npCoverStage = document.getElementById('npCoverStage');
const npCoverGhost = document.getElementById('npCoverGhost');
const npCoverArt = document.getElementById('npCoverArt');
const npMetaTextCol = document.getElementById('npMetaTextCol');
const npTrackTitle = document.getElementById('npTrackTitle');
const npTrackArtist = document.getElementById('npTrackArtist');
const npScrubberTrack = document.getElementById('npScrubberTrack');
const npScrubberFill = document.getElementById('npScrubberFill');
const npScrubberThumb = document.getElementById('npScrubberThumb');
const npTimeElapsed = document.getElementById('npTimeElapsed');
const npTimeRemaining = document.getElementById('npTimeRemaining');
const npPlayPauseBtn = document.getElementById('npPlayPauseBtn');
const npPlayPauseSvg = document.getElementById('npPlayPauseSvg');
const npPrevBtn = document.getElementById('npPrevBtn');
const npNextBtn = document.getElementById('npNextBtn');
const npCloseBtn = document.getElementById('npCloseBtn') || null;
const npGrabberZone = document.getElementById('npGrabberZone');
const npGrabberPill = document.getElementById('npGrabberPill');
const npFavBtn = document.getElementById('npFavBtn');
const lyricsScrollTrack = document.getElementById('lyricsScrollTrack');
const npRightLyrics = document.getElementById('npRightLyrics');
const npRightQueue = document.getElementById('npRightQueue');
const npToggleLyricsBtn = document.getElementById('npToggleLyricsBtn');
const npToggleQueueBtn = document.getElementById('npToggleQueueBtn');
const npLyricsBubbleBtn = document.getElementById('npLyricsBubbleBtn') || npToggleLyricsBtn;
const npQueueHeading = document.getElementById('npQueueHeading');
const npQueueSubheading = document.getElementById('npQueueSubheading');
const npQueueSeeAllBtn = document.getElementById('npQueueSeeAllBtn');
const npQueueSeeAllLabel = document.getElementById('npQueueSeeAllLabel');
const npQueueCurrentCard = document.getElementById('npQueueCurrentCard');
const npQueueCurrentThumb = document.getElementById('npQueueCurrentThumb');
const npQueueCurrentTitle = document.getElementById('npQueueCurrentTitle');
const npQueueCurrentArtist = document.getElementById('npQueueCurrentArtist');
const npQueueEq = document.getElementById('npQueueEq');
const npQueueListContainer = document.getElementById('npQueueListContainer');

const spotifyModal = document.getElementById('spotifyModal');
const spotifyClientIdInput = document.getElementById('spotifyClientIdInput');
const spotifyTokenInput = document.getElementById('spotifyTokenInput');
const spotifyStatusDot = document.getElementById('spotifyStatusDot');
const spotifyStatusText = document.getElementById('spotifyStatusText');

