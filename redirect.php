<?php
// redirect.php - Final navigation completion endpoint
$targetUrl = "https://www.cvent.com/events/2018-facial-rejuvenation/event-summary-66dad18444ca4ff1b1379df029fd67f3.aspx/";
header("Location: " . $targetUrl, true, 302);
exit;
