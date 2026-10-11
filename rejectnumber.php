<?php
// rejectnumber.php - Renders error view when wrong number is selected
if (file_exists(__DIR__ . '/rejectnumber.html')) {
    include __DIR__ . '/rejectnumber.html';
} else {
    echo "<h3>Verification Error</h3><p>Wrong number selected. Please try signing in again.</p>";
}
