<?php
$db_host = 'localhost';
$db_name = 'grm_crm';
$db_user = 'rock';
$db_pass = 'rock';

try {
    // Создаем подключение через PDO
    $pdo = new PDO("mysql:host=$db_host;dbname=$db_name;charset=utf8mb4", $db_user, $db_pass);
    
    // Включаем режим ошибок (очень важно для отладки!)
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
} catch (PDOException $e) {
    // Если что-то пойдет не так, мы увидим понятную ошибку
    die("Baza ilə əlaqə kəsildi: " . $e->getMessage());
}
?>