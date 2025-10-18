document.addEventListener('DOMContentLoaded', () => {
    const animationSelect = document.getElementById('animation-select');
    const spriteBox = document.getElementById('sprite-box');

    function updateAnimation() {
        const selectedAnimation = animationSelect.value;

        // Remove any existing animation classes
        spriteBox.className = '';

        // Add the correct class based on the selection
        if (selectedAnimation === 'explosion') {
            spriteBox.classList.add('sprite-explosion');
        } else if (selectedAnimation === 'sequence') {
            spriteBox.classList.add('sprite-sequence');
        } else if (selectedAnimation === 'ice') { // New condition for the ice sprite
            spriteBox.classList.add('sprite-ice');
        }
        
        // Ensure the sprite container can adapt to different sprite sizes
        // Resetting width/height to allow CSS classes to define them
        spriteBox.style.width = '';
        spriteBox.style.height = '';
    }

    // Listen for changes on the dropdown
    animationSelect.addEventListener('change', updateAnimation);

    // Set the initial animation on page load
    updateAnimation();
});