<?php
// Dev tool: renders the PWA icons (dumbbell on a dark rounded square). Needs GD locally only.
// Usage: php tools/make-icons.php
$out = dirname(__DIR__) . '/public/icons';
foreach ([[192, false, 'icon-192.png'], [512, false, 'icon-512.png'], [512, true, 'icon-maskable-512.png']] as [$size, $maskable, $name]) {
    $s = 4; // supersample for smooth edges
    $W = $size * $s;
    $im = imagecreatetruecolor($W, $W);
    imagesavealpha($im, true);
    imagefill($im, 0, 0, imagecolorallocatealpha($im, 0, 0, 0, 127));
    $bg = imagecolorallocate($im, 0x0f, 0x11, 0x15);
    $accent = imagecolorallocate($im, 0x3d, 0xdc, 0x97);
    if ($maskable) {
        imagefilledrectangle($im, 0, 0, $W, $W, $bg);
    } else {
        $r = (int) ($W * 0.22);
        imagefilledrectangle($im, $r, 0, $W - $r, $W, $bg);
        imagefilledrectangle($im, 0, $r, $W, $W - $r, $bg);
        foreach ([[$r, $r], [$W - $r, $r], [$r, $W - $r], [$W - $r, $W - $r]] as [$cx, $cy]) imagefilledellipse($im, $cx, $cy, 2 * $r, 2 * $r, $bg);
    }
    $k = $maskable ? 0.72 : 0.9; // keep inside the maskable safe zone
    $c = $W / 2;
    $u = $W * $k / 10;
    $rect = function ($x1, $y1, $x2, $y2) use ($im, $c, $u, $accent) {
        imagefilledrectangle($im, (int) ($c + $x1 * $u), (int) ($c + $y1 * $u), (int) ($c + $x2 * $u), (int) ($c + $y2 * $u), $accent);
    };
    $rect(-3.0, -0.35, 3.0, 0.35);   // bar
    $rect(-3.2, -2.0, -2.2, 2.0);    // inner plates
    $rect(2.2, -2.0, 3.2, 2.0);
    $rect(-4.2, -1.3, -3.4, 1.3);    // outer plates
    $rect(3.4, -1.3, 4.2, 1.3);
    $dst = imagecreatetruecolor($size, $size);
    imagesavealpha($dst, true);
    imagefill($dst, 0, 0, imagecolorallocatealpha($dst, 0, 0, 0, 127));
    imagecopyresampled($dst, $im, 0, 0, 0, 0, $size, $size, $W, $W);
    imagepng($dst, "$out/$name");
    echo "$name\n";
}
