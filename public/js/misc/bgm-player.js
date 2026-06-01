/**
 * bgm-player.js
 * BGM player with a cover-flow album carousel, track list, and an animated canvas visualizer.
 * Album data comes from data/misc/bgm_data.json; audio and cover art are served from the JforPlay CDN.
 * The visualizer is purely cosmetic (sine-wave animation) and does not use Web Audio API analysis.
 */

import { IMG_FALLBACKS, createImgElement, debounce, fetchJSON, makeKeyboardActivatable, requireElements, DATA_FOR_TOY_BASE } from '../utils.js';

document.addEventListener('DOMContentLoaded', () => {
    const albumListEl = document.getElementById('album-list');
    const albumNameEl = document.getElementById('album-name');
    const trackListEl = document.getElementById('track-list');
    const audioEl = document.getElementById('audio');
    const nowPlayingTrackEl = document.getElementById('now-playing-track');
    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    const visualizerCanvas = document.getElementById('visualizer-canvas');
    const visualizerContainer = document.querySelector('.visualizer-container');

    if (!requireElements({ albumListEl, albumNameEl, trackListEl, audioEl, nowPlayingTrackEl,
        prevBtn, nextBtn, visualizerCanvas, visualizerContainer }, 'BGM player')) {
        return;
    }

    let albumsData = {};
    let currentAlbumId = null;
    let currentPlayingAlbumId = null;
    let isScrolling = false;
    let sortedAlbumIds = [];
    let animationId = null;
    let canvasContext = null;
    let cachedAlbumItems = [];

    audioEl.volume = 0.1;

    function setStatus(message, isError = false) {
        albumNameEl.textContent = message;
        albumNameEl.classList.toggle('error-text', isError);
    }

    function isValidHttpUrl(url) {
        try {
            const parsed = new URL(url);
            return parsed.protocol === 'http:' || parsed.protocol === 'https:';
        } catch {
            return false;
        }
    }

    async function fetchData() {
        try {
            setStatus('Loading albums...');
            albumsData = await fetchJSON('data/misc/bgm_data.json');
            if (!albumsData || typeof albumsData !== 'object' || Array.isArray(albumsData)) {
                throw new Error('Unexpected BGM data format.');
            }
            displayAlbums();
        } catch (error) {
            console.error('Error fetching BGM data:', error);
            setStatus('Failed to load BGM data.', true);
            trackListEl.replaceChildren();
            albumListEl.replaceChildren();
            prevBtn.disabled = true;
            nextBtn.disabled = true;
        }
    }

    function displayAlbums() {
        const sortedAlbums = Object.entries(albumsData)
            .filter(([, album]) => album && typeof album === 'object' && album.cover)
            .sort(([, a], [, b]) => Number(a.order || 0) - Number(b.order || 0));

        sortedAlbumIds = sortedAlbums.map(([albumId]) => albumId);
        albumListEl.replaceChildren();

        sortedAlbums.forEach(([albumId, album]) => {
            const item = document.createElement('div');
            item.className = 'album-item';
            item.dataset.albumId = albumId;
            item.setAttribute('aria-label', album.album_name || `Album ${albumId}`);

            const img = createImgElement(
                `${DATA_FOR_TOY_BASE}/musiccover/${encodeURIComponent(album.cover)}.webp`,
                album.album_name || `Album ${albumId}`,
                { fallback: IMG_FALLBACKS.CARD }
            );

            item.appendChild(img);
            makeKeyboardActivatable(item, () => {
                item.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
            });
            albumListEl.appendChild(item);
        });

        cachedAlbumItems = Array.from(albumListEl.querySelectorAll('.album-item'));
        if (cachedAlbumItems.length === 0) {
            setStatus('No BGM albums found.', true);
            updateNavigationButtons();
            return;
        }

        setTimeout(() => {
            updateCarouselPadding();
            cachedAlbumItems[0].scrollIntoView({ behavior: 'auto', inline: 'center', block: 'nearest' });
            updateCarousel();
            albumListEl.style.opacity = '1';
        }, 100);
    }

    function updateCarouselPadding() {
        const firstAlbum = cachedAlbumItems[0];
        if (!firstAlbum) return;

        const containerWidth = albumListEl.offsetWidth;
        const scaledAlbumWidth = firstAlbum.getBoundingClientRect().width * 1.5;
        const padding = Math.max(0, (containerWidth / 2) - (scaledAlbumWidth / 2));

        albumListEl.style.paddingLeft = `${padding}px`;
        albumListEl.style.paddingRight = `${padding}px`;
    }

    function updateCarousel() {
        if (cachedAlbumItems.length === 0) return;

        const containerRect = albumListEl.getBoundingClientRect();
        const containerCenter = containerRect.left + containerRect.width / 2;
        let closestItem = null;
        let minDistance = Infinity;

        cachedAlbumItems.forEach(item => {
            item.classList.remove('active');
            item.setAttribute('aria-current', 'false');

            const itemRect = item.getBoundingClientRect();
            const itemCenter = itemRect.left + itemRect.width / 2;
            const distance = Math.abs(containerCenter - itemCenter);
            const maxDistance = containerRect.width / 2 || 1;
            const normalizedDistance = Math.min(distance / maxDistance, 1);
            const scale = 1.5 - (normalizedDistance * 0.9);
            const rotation = ((itemCenter - containerCenter) / containerRect.width) * 30;
            const opacity = 1 - (normalizedDistance * 0.7);

            item.style.transform = `scale(${scale}) rotateY(${rotation}deg)`;
            item.style.opacity = String(opacity);
            item.style.zIndex = String(Math.round(100 - normalizedDistance * 99));

            if (distance < minDistance) {
                minDistance = distance;
                closestItem = item;
            }
        });

        if (!closestItem) return;

        closestItem.classList.add('active');
        closestItem.setAttribute('aria-current', 'true');
        const closestAlbumId = closestItem.dataset.albumId;
        if (closestAlbumId && closestAlbumId !== currentAlbumId) {
            currentAlbumId = closestAlbumId;
            displayAlbumDetails(currentAlbumId);
            updateNavigationButtons();
        }
        updatePlayingAlbumState(!audioEl.paused && !audioEl.ended);
    }

    function updateNavigationButtons() {
        const currentIndex = sortedAlbumIds.indexOf(currentAlbumId);
        const atStart = currentIndex <= 0;
        const atEnd = currentIndex === -1 || currentIndex >= sortedAlbumIds.length - 1;

        prevBtn.disabled = atStart;
        nextBtn.disabled = atEnd;
        prevBtn.setAttribute('aria-disabled', String(atStart));
        nextBtn.setAttribute('aria-disabled', String(atEnd));
    }

    function navigateAlbum(direction) {
        const currentIndex = sortedAlbumIds.indexOf(currentAlbumId);
        const newIndex = currentIndex + direction;
        if (newIndex < 0 || newIndex >= sortedAlbumIds.length) return;

        const targetAlbumId = sortedAlbumIds[newIndex];
        const targetItem = cachedAlbumItems.find(item => item.dataset.albumId === targetAlbumId);
        if (targetItem) {
            targetItem.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        }
    }

    function displayAlbumDetails(albumId) {
        const album = albumsData[albumId];
        if (!album) return;

        const tracks = Array.isArray(album.tracks) ? album.tracks : [];
        trackListEl.replaceChildren();
        setStatus(album.album_name || 'Unknown Album');

        if (tracks.length === 0) {
            const emptyItem = document.createElement('li');
            emptyItem.className = 'track-empty';
            emptyItem.textContent = 'No tracks found for this album.';
            trackListEl.appendChild(emptyItem);
            return;
        }

        tracks.forEach((track, index) => {
            const trackItem = document.createElement('li');
            const trackButton = document.createElement('button');
            trackButton.type = 'button';
            trackButton.className = 'track-button';

            const trackTime = Number(track.music_time) || 0;
            const minutes = Math.floor(trackTime / 60000);
            const seconds = Math.floor((trackTime % 60000) / 1000);
            const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;

            const trackNumber = document.createElement('span');
            trackNumber.className = 'track-number';
            trackNumber.textContent = String(index + 1).padStart(2, '0');

            const trackName = document.createElement('span');
            trackName.className = 'track-name';
            trackName.textContent = track.name || `Track ${index + 1}`;

            const trackDuration = document.createElement('span');
            trackDuration.className = 'track-time';
            trackDuration.textContent = timeStr;

            trackButton.append(trackNumber, trackName, trackDuration);
            trackButton.addEventListener('click', () => {
                playTrack(
                    track.music_link,
                    track.name || `Track ${index + 1}`,
                    album.album_name || 'Unknown Album',
                    trackItem
                );
            });
            trackItem.appendChild(trackButton);
            trackListEl.appendChild(trackItem);
        });
    }

    function playTrack(musicUrl, trackName, albumName, trackElement) {
        if (!musicUrl || !isValidHttpUrl(musicUrl)) {
            nowPlayingTrackEl.textContent = `Track not found: ${trackName}`;
            console.error('Music link was missing or invalid for track:', trackName);
            return;
        }

        audioEl.src = musicUrl;
        nowPlayingTrackEl.textContent = trackName;
        albumNameEl.textContent = albumName;
        albumNameEl.classList.remove('error-text');
        currentPlayingAlbumId = currentAlbumId;

        trackListEl.querySelectorAll('li').forEach(li => {
            li.classList.remove('playing');
            li.querySelector('.track-button')?.setAttribute('aria-current', 'false');
        });
        if (trackElement) {
            trackElement.classList.add('playing');
            trackElement.querySelector('.track-button')?.setAttribute('aria-current', 'true');
        }

        updatePlayingAlbumState(true);

        if (!canvasContext) {
            initVisualizer();
        }

        audioEl.play().catch(error => {
            console.error('Audio playback failed:', error);
            nowPlayingTrackEl.textContent = `Playback blocked: ${trackName}`;
            updatePlayingAlbumState(false);
        });
    }

    function updatePlayingAlbumState(isPlaying) {
        cachedAlbumItems.forEach(item => {
            item.classList.toggle('playing', isPlaying && item.dataset.albumId === currentPlayingAlbumId);
        });
    }

    function initVisualizer() {
        try {
            canvasContext = visualizerCanvas.getContext('2d');
            resizeCanvas();
            visualizerContainer.classList.add('active');
            drawVisualizer();
        } catch (error) {
            console.error('Error initializing visualizer:', error);
        }
    }

    function resizeCanvas() {
        const rect = visualizerCanvas.getBoundingClientRect();
        const ratio = window.devicePixelRatio || 1;

        visualizerCanvas.width = Math.max(1, Math.round(rect.width * ratio));
        visualizerCanvas.height = Math.max(1, Math.round(rect.height * ratio));
        canvasContext.setTransform(ratio, 0, 0, ratio, 0, 0);
    }

    function drawVisualizer() {
        animationId = requestAnimationFrame(drawVisualizer);

        const ratio = window.devicePixelRatio || 1;
        const width = visualizerCanvas.width / ratio;
        const height = visualizerCanvas.height / ratio;

        canvasContext.clearRect(0, 0, width, height);

        const isDarkMode = document.body.classList.contains('dark-mode');
        const accentColor = isDarkMode ? '#667eea' : '#5e72e4';
        const gradientStart = isDarkMode ? '#667eea' : '#5e72e4';
        const gradientEnd = isDarkMode ? '#764ba2' : '#825ee4';
        const barCount = 64;
        const barWidth = width / barCount;
        const barGap = 2;
        const time = Date.now() / 1000;

        for (let i = 0; i < barCount; i++) {
            const wave1 = Math.sin(time * 2 + i * 0.15) * 0.3;
            const wave2 = Math.sin(time * 3 - i * 0.1) * 0.2;
            const wave3 = Math.sin(time * 1.5 + i * 0.2) * 0.25;
            const amplitude = (wave1 + wave2 + wave3 + 1) / 2;
            const barHeight = amplitude * height * 0.8;
            const x = i * barWidth;
            const y = height - barHeight;
            const gradient = canvasContext.createLinearGradient(x, y, x, height);

            gradient.addColorStop(0, gradientStart);
            gradient.addColorStop(1, gradientEnd);

            canvasContext.fillStyle = gradient;
            canvasContext.fillRect(x, y, barWidth - barGap, barHeight);

            if (barHeight > height * 0.5) {
                canvasContext.shadowBlur = 10;
                canvasContext.shadowColor = accentColor;
                canvasContext.fillRect(x, y, barWidth - barGap, barHeight);
                canvasContext.shadowBlur = 0;
            }
        }
    }

    prevBtn.addEventListener('click', () => navigateAlbum(-1));
    nextBtn.addEventListener('click', () => navigateAlbum(1));

    audioEl.addEventListener('play', () => updatePlayingAlbumState(true));
    audioEl.addEventListener('pause', () => updatePlayingAlbumState(false));
    audioEl.addEventListener('ended', () => updatePlayingAlbumState(false));
    audioEl.addEventListener('error', () => {
        nowPlayingTrackEl.textContent = 'Unable to load this track.';
        updatePlayingAlbumState(false);
    });

    albumListEl.addEventListener('scroll', () => {
        if (isScrolling) return;
        window.requestAnimationFrame(() => {
            updateCarousel();
            isScrolling = false;
        });
        isScrolling = true;
    });

    albumListEl.addEventListener('wheel', event => {
        if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
        event.preventDefault();
        albumListEl.scrollLeft += event.deltaY;
    }, { passive: false });

    window.addEventListener('resize', debounce(() => {
        updateCarouselPadding();
        updateCarousel();
        if (canvasContext) {
            resizeCanvas();
        }
    }, 100));

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            if (animationId) {
                cancelAnimationFrame(animationId);
                animationId = null;
            }
        } else if (canvasContext && !animationId) {
            drawVisualizer();
        }
    });

    window.addEventListener('pagehide', () => {
        if (animationId) {
            cancelAnimationFrame(animationId);
            animationId = null;
        }
    }, { once: true });

    fetchData();
});
