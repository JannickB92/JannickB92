<?php
// Dev tool: validates the exercise catalog and downloads the exercise images
// from the public-domain free-exercise-db (https://github.com/yuhonas/free-exercise-db).
// Usage: php tools/fetch-images.php
declare(strict_types=1);

$root = dirname(__DIR__);
$catalog = json_decode(file_get_contents("$root/public/data/exercises.json"), true, 512, JSON_THROW_ON_ERROR);
$base = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/';

$muscles = ['borst','rug','schouders','biceps','triceps','quadriceps','hamstrings','billen','kuiten','core','onderrug','onderarmen','heupen','conditie'];
$ids = [];
foreach ($catalog as $ex) {
    if (isset($ids[$ex['id']])) fwrite(STDERR, "Duplicate id {$ex['id']}\n");
    $ids[$ex['id']] = true;
    foreach ($ex['muscles'] as $m) if (!in_array($m, $muscles, true)) fwrite(STDERR, "Unknown muscle '$m' in {$ex['id']}\n");

    $dir = "$root/public/img/ex/{$ex['id']}";
    if (!is_dir($dir)) mkdir($dir, 0775, true);
    foreach ([0, 1] as $i) {
        $target = "$dir/$i.jpg";
        if (is_file($target)) continue;
        $data = @file_get_contents($base . rawurlencode($ex['src']) . "/$i.jpg");
        if ($data === false) { fwrite(STDERR, "Missing image {$ex['src']}/$i.jpg\n"); continue; }
        file_put_contents($target, $data);
        echo "OK {$ex['id']}/$i.jpg\n";
    }
}
echo count($catalog) . " exercises checked\n";
