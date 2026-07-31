<?php
session_start();
// Проверка: если пользователь не авторизован, отправляем на логин
if (!isset($_SESSION['user_id'])) {
    header("Location: login.php");
    exit;
}

require_once 'db.php';

// Логика выхода
if (isset($_GET['logout'])) {
    session_destroy();
    header("Location: login.php");
    exit;
}

try {
    $clientCount = $pdo->query("SELECT COUNT(*) FROM clients")->fetchColumn();
} catch (Exception $e) { $clientCount = 0; }
?>

<!DOCTYPE html>
<html lang="az">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>GRM Group Co. - CRM Panel</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.0/font/bootstrap-icons.css">
    <style>
        body { background-color: #c0dce3; font-family: 'Segoe UI', sans-serif; min-height: 100vh; display: flex; align-items: center; }
        .main-card { border-radius: 20px; border: none; box-shadow: 0 15px 35px rgba(0,0,0,0.1); overflow: hidden; }
        .sidebar-brand { background: #047590; color: white; padding: 30px; text-align: center; }
        .menu-card { transition: all 0.3s ease; border: 2px solid transparent; cursor: pointer; text-decoration: none; color: inherit; height: 100%; position: relative; }
        .menu-card:hover { transform: translateY(-5px); border-color: #047590; }
        .icon-box { width: 50px; height: 50px; background: #eef7f9; color: #047590; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 1.2rem; margin-bottom: 15px; }
        .logout-link { color: rgba(255,255,255,0.6); text-decoration: none; font-size: 0.8rem; }
        .logout-link:hover { color: white; }
        .dropdown-menu { border-radius: 12px; border: none; box-shadow: 0 10px 20px rgba(0,0,0,0.1); }
    </style>
</head>
<body>

<div class="container">
    <div class="row justify-content-center">
        <div class="col-lg-10">
            <div class="card main-card bg-white">
                <div class="row g-0">
                    <!-- Sidebar -->
                    <div class="col-md-4 sidebar-brand d-flex flex-column justify-content-between">
                        <div>
                            <i class="bi bi-rocket-takeoff mb-3" style="font-size: 2.5rem; display: block;"></i>
                            <h3 class="fw-bold">GRM Group Co.</h3>
                            <p class="small opacity-75">Xoş gəldiniz, <?= htmlspecialchars($_SESSION['username']) ?></p>
                        </div>
                        
                        <div class="mt-4">
                            <div class="badge bg-white bg-opacity-25 p-2 mb-3 w-100">
                                <i class="bi bi-people-fill"></i> <?= $clientCount ?> Müştəri bazada
                            </div>
                        </br>
                            <a href="?logout=1" class="logout-link border border-white border-opacity-25 rounded px-3 py-1">
                                <i class="bi bi-box-arrow-left"></i> Çıxış
                            </a>
                        </div>
                    </div>

                    <!-- Main Menu -->
                    <div class="col-md-8 p-5">
                        <div class="mb-4">
                            <h4 class="fw-bold text-dark">İdarəetmə Paneli</h4>
                            <p class="text-muted small">Lazımi bölməni seçin:</p>
                        </div>

                        <div class="row g-3">
                            <!-- Блок Мюгавилелер с выбором типа -->
                            <div class="col-md-6 dropdown">
                                <div class="card menu-card p-3" data-bs-toggle="dropdown" aria-expanded="false">
                                    <div class="icon-box"><i class="bi bi-file-earmark-text"></i></div>
                                    <h6 class="fw-bold mb-1">Müqavilələr</h6>
                                    <p class="text-muted" style="font-size: 0.7rem;">Yeni müqavilə hazırlamaq</p>
                                </div>
                                <ul class="dropdown-menu w-100 p-2">
                                    <li><a class="dropdown-item rounded" href="konsalting.php"><i class="bi bi-briefcase me-2"></i> Konsaltinq</a></li>
                                    <li><a class="dropdown-item rounded" href="alqi-satqi.php"><i class="bi bi-cart me-2"></i> Alqı-Satqı</a></li>
                                </ul>
                            </div>

                            <!-- Блок Тяхвиль-Тяслим -->
                            <div class="col-md-6">
                                <a href="tahvil-taslim.php" class="card menu-card p-3">
                                    <div class="icon-box"><i class="bi bi-file-earmark-check"></i></div>
                                    <h6 class="fw-bold mb-1">Təhvil-təslim</h6>
                                    <p class="text-muted" style="font-size: 0.7rem;">Görülmüş iş aktları</p>
                                </a>
                            </div>

                            <!-- Блок Инвойслар -->
                            <div class="col-md-6">
                                <a href="invoice.php" class="card menu-card p-3">
                                    <div class="icon-box"><i class="bi bi-receipt"></i></div>
                                    <h6 class="fw-bold mb-1">İnvoyslar</h6>
                                    <p class="text-muted" style="font-size: 0.7rem;">Hesab-faktura yarat</p>
                                </a>
                            </div>

                            <!-- Блок Мюштяриляр -->
                            <div class="col-md-6">
                                <a href="sirketler.php" class="card menu-card p-3">
                                    <div class="icon-box"><i class="bi bi-building"></i></div>
                                    <h6 class="fw-bold mb-1">Müştərilər</h6>
                                    <p class="text-muted" style="font-size: 0.7rem;">Şirkətlər və partnyorlar</p>
                                </a>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>

<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
</body>
</html>