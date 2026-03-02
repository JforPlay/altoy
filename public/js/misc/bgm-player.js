import { fetchJSON } from '../utils.js';
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

    let albumsData = {};
    let currentAlbumId = null;
    let isScrolling = false;
    let sortedAlbumIds = [];
    let animationId = null;
    let canvasContext = null;
    let cachedAlbumItems = [];

    // Set default volume to 10%
    audioEl.volume = 0.1;

    async function fetchData() {
        try {
            albumsData = await fetchJSON('data/misc/bgm_data.json');
            displayAlbums();
        } catch (error) {
            console.error('Error fetching data:', error);
            albumNameEl.textContent = 'Failed to load data.';
        }
    }

    function displayAlbums() {
        const sortedAlbums = Object.values(albumsData).sort((a, b) => a.order - b.order);
        sortedAlbumIds = sortedAlbums.map(album => 
            Object.keys(albumsData).find(key => albumsData[key] === album)
        );

        albumListEl.innerHTML = sortedAlbums.map(album => {
            const albumId = Object.keys(albumsData).find(key => albumsData[key] === album);
            if (!album.cover) return ''; 
            
            const imageUrl = `https://raw.githubusercontent.com/JforPlay/data_for_toy/main/musiccover/${album.cover}.webp`;

            return `
                <div class="album-item" data-album-id="${albumId}">
                    <img src="${imageUrl}" alt="${album.album_name}" loading="lazy">
                </div>
            `;
        }).join('');

        cachedAlbumItems = Array.from(albumListEl.querySelectorAll('.album-item'));
        cachedAlbumItems.forEach(item => {
            item.addEventListener('click', () => {
                item.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
            });
        });

        setTimeout(() => {
            const firstAlbum = albumListEl.querySelector('.album-item');
            if (firstAlbum) {
                const containerWidth = albumListEl.offsetWidth;
                // Use the scaled-up size (1.5x) for padding calculation
                // Adjust for mobile screen width
                const isMobile = window.innerWidth <= 768;
                const baseWidth = isMobile ? 120 : 240;
                const scaledAlbumWidth = baseWidth * 1.5;
                const padding = (containerWidth / 2) - (scaledAlbumWidth / 2);

                albumListEl.style.paddingLeft = `${padding}px`;
                albumListEl.style.paddingRight = `${padding}px`;
                firstAlbum.scrollIntoView({ behavior: 'auto', inline: 'center', block: 'nearest' });
            }

            albumListEl.addEventListener('scroll', () => {
                if (!isScrolling) {
                    window.requestAnimationFrame(() => {
                        updateCarousel();
                        isScrolling = false;
                    });
                    isScrolling = true;
                }
            });

            // Mouse wheel horizontal scroll
            albumListEl.addEventListener('wheel', (e) => {
                e.preventDefault();
                albumListEl.scrollLeft += e.deltaY;
            }, { passive: false });

            updateCarousel();
            albumListEl.style.opacity = '1';
        }, 100);
    }

    function updateCarousel() {
        if (cachedAlbumItems.length === 0) return;

        const containerRect = albumListEl.getBoundingClientRect();
        const containerCenter = containerRect.left + containerRect.width / 2;
        let closestItem = null;
        let minDistance = Infinity;

        cachedAlbumItems.forEach(item => {
            item.classList.remove('active');

            const itemRect = item.getBoundingClientRect();
            const itemCenter = itemRect.left + itemRect.width / 2;
            const distance = Math.abs(containerCenter - itemCenter);

            const maxDistance = containerRect.width / 2;
            const normalizedDistance = Math.min(distance / maxDistance, 1);

            // Smoother scaling curve
            const scale = 1.5 - (normalizedDistance * 0.9);
            const rotation = ((itemCenter - containerCenter) / containerRect.width) * 30;
            const opacity = 1 - (normalizedDistance * 0.7);

            item.style.transform = `scale(${scale}) rotateY(${rotation}deg)`;
            item.style.opacity = opacity;
            item.style.zIndex = Math.round(100 - normalizedDistance * 99);

            if (distance < minDistance) {
                minDistance = distance;
                closestItem = item;
            }
        });

        if (closestItem) {
            closestItem.classList.add('active');
            const closestAlbumId = closestItem.dataset.albumId;
            if (closestAlbumId && closestAlbumId !== currentAlbumId) {
                currentAlbumId = closestAlbumId;
                displayAlbumDetails(currentAlbumId);
                updateNavigationButtons();
            }
        }
    }

    function updateNavigationButtons() {
        const currentIndex = sortedAlbumIds.indexOf(currentAlbumId);
        prevBtn.disabled = currentIndex === 0;
        nextBtn.disabled = currentIndex === sortedAlbumIds.length - 1;
    }

    function navigateAlbum(direction) {
        const currentIndex = sortedAlbumIds.indexOf(currentAlbumId);
        let newIndex = currentIndex + direction;
        
        if (newIndex < 0 || newIndex >= sortedAlbumIds.length) return;
        
        const targetAlbumId = sortedAlbumIds[newIndex];
        const targetItem = albumListEl.querySelector(`.album-item[data-album-id='${targetAlbumId}']`);
        
        if (targetItem) {
            targetItem.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        }
    }

    prevBtn.addEventListener('click', () => navigateAlbum(-1));
    nextBtn.addEventListener('click', () => navigateAlbum(1));

    function displayAlbumDetails(albumId) {
        const album = albumsData[albumId];
        if (!album) return;

        const tracks = album.tracks || [];
        trackListEl.innerHTML = '';
        tracks.forEach((track, index) => {
            const trackItem = document.createElement('li');
            
            // Convert music_time from milliseconds to MM:SS format
            const minutes = Math.floor(track.music_time / 60000);
            const seconds = Math.floor((track.music_time % 60000) / 1000);
            const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;
            
            trackItem.innerHTML = `
                <span class="track-number">${String(index + 1).padStart(2, '0')}</span>
                <span class="track-name">${track.name}</span>
                <span class="track-time">${timeStr}</span>
            `;
            trackItem.addEventListener('click', () => playTrack(track.music_link, track.name, album.album_name, trackItem));
            trackListEl.appendChild(trackItem);
        });
    }

    function playTrack(musicUrl, trackName, albumName, trackElement) {
        if (musicUrl) {
            audioEl.src = musicUrl;
            audioEl.play();
            nowPlayingTrackEl.textContent = trackName;
            albumNameEl.textContent = albumName;

            // Highlight active track
            document.querySelectorAll('#track-list li').forEach(li => li.classList.remove('playing'));
            if (trackElement) trackElement.classList.add('playing');

            // Add playing class to active album
            updatePlayingAlbumState(true);

            // Initialize visualizer on first play
            if (!canvasContext) {
                initVisualizer();
            }
        } else {
            nowPlayingTrackEl.textContent = `Track not found: ${trackName}`;
            console.error('Music link was missing for track:', trackName);
        }
    }

    // Update playing state on active album
    function updatePlayingAlbumState(isPlaying) {
        const activeAlbum = albumListEl.querySelector('.album-item.active');
        if (activeAlbum) {
            if (isPlaying) {
                activeAlbum.classList.add('playing');
            } else {
                activeAlbum.classList.remove('playing');
            }
        }
    }

    // Simple Animated Visualizer (no audio analysis needed)
    function initVisualizer() {
        try {
            // Canvas setup
            canvasContext = visualizerCanvas.getContext('2d');
            resizeCanvas();

            // Start visualization
            visualizerContainer.classList.add('active');
            drawVisualizer();
        } catch (error) {
            console.error('Error initializing visualizer:', error);
        }
    }

    function resizeCanvas() {
        const rect = visualizerCanvas.getBoundingClientRect();
        visualizerCanvas.width = rect.width * window.devicePixelRatio;
        visualizerCanvas.height = rect.height * window.devicePixelRatio;
        canvasContext.scale(window.devicePixelRatio, window.devicePixelRatio);
    }

    function drawVisualizer() {
        animationId = requestAnimationFrame(drawVisualizer);

        const width = visualizerCanvas.width / window.devicePixelRatio;
        const height = visualizerCanvas.height / window.devicePixelRatio;

        // Clear canvas
        canvasContext.clearRect(0, 0, width, height);

        // Get theme colors
        const isDarkMode = document.body.classList.contains('dark-mode');
        const accentColor = isDarkMode ? '#667eea' : '#5e72e4';
        const gradientStart = isDarkMode ? '#667eea' : '#5e72e4';
        const gradientEnd = isDarkMode ? '#764ba2' : '#825ee4';

        // Draw animated bars
        const barCount = 64;
        const barWidth = width / barCount;
        const barGap = 2;
        const time = Date.now() / 1000; // Current time in seconds

        for (let i = 0; i < barCount; i++) {
            // Create wave patterns with different frequencies
            const wave1 = Math.sin(time * 2 + i * 0.15) * 0.3;
            const wave2 = Math.sin(time * 3 - i * 0.1) * 0.2;
            const wave3 = Math.sin(time * 1.5 + i * 0.2) * 0.25;

            // Combine waves for natural-looking motion
            const amplitude = (wave1 + wave2 + wave3 + 1) / 2; // Normalize to 0-1
            const barHeight = amplitude * height * 0.8;

            const x = i * barWidth;
            const y = height - barHeight;

            // Create gradient for each bar
            const gradient = canvasContext.createLinearGradient(x, y, x, height);
            gradient.addColorStop(0, gradientStart);
            gradient.addColorStop(1, gradientEnd);

            canvasContext.fillStyle = gradient;
            canvasContext.fillRect(x, y, barWidth - barGap, barHeight);

            // Add glow effect to taller bars
            if (barHeight > height * 0.5) {
                canvasContext.shadowBlur = 10;
                canvasContext.shadowColor = accentColor;
                canvasContext.fillRect(x, y, barWidth - barGap, barHeight);
                canvasContext.shadowBlur = 0;
            }
        }
    }

    // Handle audio play/pause events
    audioEl.addEventListener('play', () => {
        updatePlayingAlbumState(true);
    });

    audioEl.addEventListener('pause', () => {
        updatePlayingAlbumState(false);
    });

    audioEl.addEventListener('ended', () => {
        updatePlayingAlbumState(false);
    });

    // Handle window resize
    window.addEventListener('resize', () => {
        if (canvasContext) {
            resizeCanvas();
        }
    });

    // Pause/resume visualizer when page visibility changes
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

    fetchData();
});