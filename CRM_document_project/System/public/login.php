<?php
session_start();
require_once 'db.php';

$error = "";

// Ваши целевые данные
$target_user = 'grmgroup';
$target_pass = 'ulker4210844A!#';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $user = trim($_POST['username'] ?? '');
    $pass = trim($_POST['password'] ?? '');

    // 1. Поиск пользователя в базе
    $stmt = $pdo->prepare("SELECT * FROM users WHERE username = ?");
    $stmt->execute([$user]);
    $userData = $stmt->fetch();

    // 2. Логика "Авто-исправления" для вашего конкретного пароля
    if ($user === $target_user && $pass === $target_pass) {
        // Если в базе пользователя нет или пароль не подходит (старый хеш)
        if (!$userData || !password_verify($pass, $userData['password'])) {
            $new_hash = password_hash($target_pass, PASSWORD_DEFAULT);
            
            if (!$userData) {
                // Создаем, если не было
                $ins = $pdo->prepare("INSERT INTO users (username, password) VALUES (?, ?)");
                $ins->execute([$target_user, $new_hash]);
            } else {
                // Обновляем хеш, если он был неверный
                $upd = $pdo->prepare("UPDATE users SET password = ? WHERE username = ?");
                $upd->execute([$new_hash, $target_user]);
            }
            
            // После исправления получаем данные заново
            $stmt->execute([$user]);
            $userData = $stmt->fetch();
        }
    }

    // 3. Стандартная проверка
    if ($userData && password_verify($pass, $userData['password'])) {
        $_SESSION['user_id'] = $userData['id'];
        $_SESSION['username'] = $userData['username'];
        header("Location: index.php");
        exit;
    } else {
        $error = "İstifadəçi adı və ya şifrə yanlışdır!";
    }
}
?>

<!DOCTYPE html>
<html lang="az">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>GRM Group - Giriş</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <style>
        body { background-color: #c0dce3; height: 100vh; display: flex; align-items: center; justify-content: center; font-family: 'Segoe UI', sans-serif; }
        .login-card { border-radius: 20px; border: none; width: 100%; max-width: 400px; box-shadow: 0 15px 35px rgba(0,0,0,0.1); background: white; }
        .btn-login { background: #047590; color: white; font-weight: 600; border-radius: 10px; transition: 0.3s; }
        .btn-login:hover { background: #035b71; transform: translateY(-2px); color: white; }
        .form-control { border-radius: 10px; padding: 12px; border: 1px solid #e0e0e0; }
        .form-control:focus { border-color: #047590; box-shadow: 0 0 0 0.25rem rgba(4, 117, 144, 0.1); }
        .logo-text { color: #047590; letter-spacing: 1px; }
    </style>
</head>
<body>
    <div class="card login-card p-4">
        <div class="text-center mb-4">
            <h4 class="fw-bold logo-text">GRM Group Co. - CRM</h4>
            <p class="text-muted small">Sistemə daxil olmaq üçün məlumatları yazın</p>
        </div>
        
        <?php if($error): ?>
            <div class="alert alert-danger py-2 small text-center border-0 shadow-sm mb-3"><?= $error ?></div>
        <?php endif; ?>

        <form method="POST">
            <div class="mb-3">
                <label class="form-label small fw-bold text-secondary">İstifadəçi adı</label>
                <input type="text" name="username" class="form-control" placeholder="Məsələn: admin" required autofocus>
            </div>
            <div class="mb-4">
                <label class="form-label small fw-bold text-secondary">Şifrə</label>
                <input type="password" name="password" class="form-control" placeholder="••••••••" required>
            </div>
            <button type="submit" class="btn btn-login w-100 py-3 mb-2">GİRİŞ ET</button>
        </form>
        <div class="text-center mt-3">
            <span class="text-muted small">© 2025 - <?= date('Y') ?> GRM Group Co.</span>
        </div>
    </div>
</body>
</html>