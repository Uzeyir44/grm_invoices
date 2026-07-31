<?php
session_start();
// Защита: бэкап может делать только авторизованный пользователь
if (!isset($_SESSION['user_id'])) {
    header("Location: login.php");
    exit;
}

// Увеличиваем лимиты времени и памяти, так как файлов и данных может быть много
set_time_limit(600);
ini_set('memory_limit', '512M');

// Подключаем настройки вашей базы данных
require_once 'db.php'; 

$message = "";
$backupFileUrl = "";

if (isset($_POST['create_backup'])) {
    try {
        $dateStr = date('Y-m-d_H-i-s');
        $backupDir = __DIR__ . '/backups/';
        
        // Создаем папку для бэкапов, если её нет, и принудительно задаем права 0777
        if (!file_exists($backupDir)) {
            if (!mkdir($backupDir, 0777, true)) {
                throw new Exception("Сервер запретил создание папки 'backups'. Выполните команду 'sudo mkdir backups' в терминале.");
            }
        }
        
        // На всякий случай принудительно обновляем права на папку из PHP
        @chmod($backupDir, 0777);

        $zipFileName = 'grm_backup_' . $dateStr . '.zip';
        $zipPath = $backupDir . $zipFileName;
        
        $zip = new ZipArchive();
        if ($zip->open($zipPath, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== TRUE) {
            throw new Exception("Не удалось создать итоговый ZIP архив. Проверьте свободное место на сервере.");
        }

        // 1. Генерация дампа базы данных на чистом PHP (PDO)
        $sqlDumpFile = $backupDir . 'db_backup_' . $dateStr . '.sql';
        $handle = @fopen($sqlDumpFile, 'w');
        
        if (!$handle) {
            throw new Exception("Не удалось создать временный SQL файл в папке backups. Недостаточно прав (Permission Denied). Выполните в терминале сервера: <strong>sudo chmod -R 777 " . htmlspecialchars($backupDir) . "</strong>");
        }

        // Записываем кодировку в начало файла
        fwrite($handle, "SET NAMES 'utf8mb4';\n\n");

        // Получаем список всех таблиц в базе данных
        $tables = [];
        $query = $pdo->query("SHOW TABLES");
        while ($row = $query->fetch(PDO::FETCH_NUM)) {
            $tables[] = $row[0];
        }

        // Цикл по всем таблицам для экспорта структуры и данных
        foreach ($tables as $table) {
            // 구조 (CREATE TABLE)
            $showCreate = $pdo->query("SHOW CREATE TABLE `" . $table . "`")->fetch(PDO::FETCH_ASSOC);
            fwrite($handle, "DROP TABLE IF EXISTS `" . $table . "`;\n");
            fwrite($handle, $showCreate['Create Table'] . ";\n\n");

            // Данные таблицы
            $result = $pdo->query("SELECT * FROM `" . $table . "`");
            $columnCount = $result->columnCount();

            while ($row = $result->fetch(PDO::FETCH_NUM)) {
                $insertQuery = "INSERT INTO `" . $table . "` VALUES(";
                for ($j = 0; $j < $columnCount; $j++) {
                    if (isset($row[$j])) {
                        $value = str_replace(array("\x00", "\n", "\r", "\\", "'", "\x1a"), array('\\x00', '\\n', '\\r', '\\\\', "''", '\\x1a'), $row[$j]);
                        $insertQuery .= "'" . $value . "'";
                    } else {
                        $insertQuery .= "NULL";
                    }
                    if ($j < ($columnCount - 1)) {
                        $insertQuery .= ",";
                    }
                }
                $insertQuery .= ");\n";
                fwrite($handle, $insertQuery);
            }
            fwrite($handle, "\n\n\n");
        }
        
        fclose($handle);

        // Добавляем сгенерированный файл БД в ZIP-архив
        if (file_exists($sqlDumpFile) && filesize($sqlDumpFile) > 0) {
            $zip->addFile($sqlDumpFile, 'database_backup.sql');
        } else {
            throw new Exception("Не удалось корректно сформировать дамп базы данных.");
        }

        // 2. Архивирование системных файлов веб-интерфейса
        $rootPath = realpath(__DIR__ . '/'); 
        
        $files = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($rootPath, RecursiveDirectoryIterator::SKIP_DOTS),
            RecursiveIteratorIterator::LEAVES_ONLY
        );

        foreach ($files as $name => $file) {
            // Пропускаем саму папку с бэкапами, чтобы избежать бесконечной рекурсии
            if ($file->isDir() || strpos($file->getRealPath(), $backupDir) !== false) {
                continue;
            }

            $filePath = $file->getRealPath();
            $relativePath = substr($filePath, strlen($rootPath) + 1);

            $zip->addFile($filePath, $relativePath);
        }

        // Закрываем и сохраняем ZIP архив
        $zip->close();

        // Удаляем временный SQL файл с сервера, так как он уже сохранен внутри ZIP
        if (file_exists($sqlDumpFile)) {
            unlink($sqlDumpFile);
        }

        $backupFileUrl = 'backups/' . $zipFileName;
        $message = "
        <div class='alert alert-success border-0 shadow-sm text-center'>
            <strong>Бэкап успешно создан!</strong><br>
            База данных и системные файлы успешно упакованы.<br>
            <a href='$backupFileUrl' download class='btn btn-download mt-3 fw-bold text-white px-4 py-2'>Скачать архив (.zip)</a>
        </div>";

    } catch (Exception $e) {
        $message = "<div class='alert alert-danger shadow-sm text-center'><strong>Ошибка:</strong> " . $e->getMessage() . "</div>";
    }
}
?>

<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>GRM Group Co. - Резервное копирование</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <style>
        body { background-color: #c0dce3; font-family: 'Segoe UI', sans-serif; }
        .card { border-radius: 15px; border: none; box-shadow: 0 10px 30px rgba(0,0,0,0.1); }
        .btn-grm { background: #047590; color: white; transition: 0.3s; font-weight: 600; padding: 15px; }
        .btn-grm:hover { background: #035b71; color: white; transform: translateY(-2px); }
        .btn-download { background: #28a745; border: none; transition: 0.2s; }
        .btn-download:hover { background: #218838; transform: scale(1.05); }
        .btn-back { background: #6c757d; color: white; text-decoration: none; border-radius: 8px; font-size: 0.85rem; }
        .btn-back:hover { background: #5a6268; color: white; }
    </style>
</head>
<body>

<div class="container py-5">
    <div class="row justify-content-center py-5">
        <div class="col-md-6">
            <div class="text-center mb-4">
                <h2 class="fw-bold" style="color: #047590;">Резервное копирование</h2>
                <p class="text-muted small text-uppercase">GRM Group Co. — Безопасность Системы</p>
            </div>

            <?= $message ?>

            <div class="card p-4 mt-3 text-center">
                <p class="text-muted mb-4" style="font-size: 0.9rem;">
                    Нажмите кнопку ниже, чтобы запустить полное резервное копирование веб-интерфейса, шаблонов документов .docx, загруженных файлов и текущего состояния базы данных CRM.
                </p>
                
                <form method="POST">
                    <button type="submit" name="create_backup" class="btn btn-grm w-100 text-uppercase shadow-sm mb-3">
                        🔄 Создать полный бэкап системы
                    </button>
                </form>

                <div class="mt-2">
                    <a href="index.php" class="btn btn-back px-3 py-1">На главную</a>
                </div>
            </div>
        </div>
    </div>
</div>

</body>
</html>