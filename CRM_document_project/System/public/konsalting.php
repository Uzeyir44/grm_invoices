<?php
session_start();
if (!isset($_SESSION['user_id'])) {
    header("Location: login.php");
    exit;
}
// 1. Загрузка зависимостей и подключение к базе
require_once __DIR__ . '/../vendor/autoload.php';
require_once 'db.php'; // Файл с подключением к БД

use Grm\DocGenerator;

$message = "";

// --- 2. Получение списка клиентов из базы для автозаполнения ---
try {
    $clients = $pdo->query("SELECT * FROM clients ORDER BY company_name, fullname ASC")->fetchAll(PDO::FETCH_ASSOC);
} catch (PDOException $e) {
    $clients = [];
}

// --- 3. Обработка формы ---
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['generate'])) {
    try {
        $type = $_POST['person_type'] ?? 'physical';
        
        // Автоматический расчет даты окончания (+1 год)
        $contractDateStr = $_POST['contract_date'] ?? '';
        if (!empty($contractDateStr)) {
            $dateObj = new DateTime($contractDateStr);
            if ($dateObj) {
                $dateObj->modify('+1 year');
                $_POST['contract_end_date'] = $dateObj->format('d.m.Y');
            }
        } else {
            $_POST['contract_end_date'] = "N/A";
        }

        // Выбор шаблона для консалтинга
        $templateFile = ($type === 'physical') ? 'fiziki_muqavile_konsalting_template_leo.docx' : 'huquqi_muqavile_konsalting_template_leo.docx';
        $contractNum = !empty($_POST['contract_num']) ? $_POST['contract_num'] : time();
        $outputFileName = 'Müqavilə №' . $contractNum;

        // Генерация документа
        $file = DocGenerator::generate($templateFile, $_POST, $outputFileName);
        
        $message = "
        <div class='alert alert-success border-0 shadow-sm text-center'>
            <strong>Uğurlu əməliyyat!</strong> Müqavilə tərtib olunub.<br>
            <a href='uploads/$file' class='btn btn-generate btn-sm mt-2 fw-bold text-white'>Yüklə .docx</a>
        </div>";
        
    } catch (Exception $e) {
        $message = "<div class='alert alert-danger shadow-sm'>Xəta: " . $e->getMessage() . "</div>";
    }
}
?>

<!DOCTYPE html>
<html lang="az">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>GRM Group - Konsalting CRM</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <style>
        body { background-color: #c0dce3; font-family: 'Segoe UI', sans-serif; }
        .card { border-radius: 15px; border: none; box-shadow: 0 10px 30px rgba(0,0,0,0.1); }
        .nav-pills .nav-link { color: #555; font-weight: 500; }
        .nav-pills .nav-link.active { background-color: #047590; }
        .section-title { font-size: 0.85rem; font-weight: 700; color: #047590; text-transform: uppercase; border-bottom: 2px solid #eee; padding-bottom: 5px; margin-bottom: 15px; }
        .btn-grm { background: #047590; color: white; transition: 0.3s;}
        .btn-grm:hover { background: #035b71; color: white; transform: translateY(-2px); }
        label { font-size: 0.75rem; font-weight: 600; color: #444; margin-top: 10px; }
        .form-control-sm { border-radius: 8px; }
        .btn-generate { background: #047590; color: white; border: none; padding: 12px; font-weight: 600; }
        .btn-generate:hover { background: #035b71; color: white; }
        .client-selector { background: #f8f9fa; border: 2px dashed #047590; border-radius: 10px; padding: 15px; margin-bottom: 20px; }
    </style>
</head>
<body>

<div class="container py-5">
    <div class="row justify-content-center">
        <div class="col-lg-10">
            <div class="text-center mb-4">
                <h2 class="fw-bold" style="color: #047590;">Konsalting Xidməti Müqaviləsi</h2>
                <p class="text-muted small text-uppercase">GRM Group Co. İdarəetmə Paneli</p>
            </div>
           

            <?= $message ?>

            <div class="card p-4 shadow-lg">
                <form method="POST">
                    
                    <!-- Выбор из базы данных -->
                    <div class="client-selector">
                        <label class="mt-0 text-primary text-uppercase" style="font-size: 0.65rem;">Müştəri bazasından seçin (Avtomatik doldurma)</label>
                        <select id="db_client_select" class="form-select form-select-sm mt-1" onchange="autoFillClient()">
                            <option value="">-- Müştəri seçin --</option>
                            <?php foreach ($clients as $client): ?>
                                <option value='<?= htmlspecialchars(json_encode($client), ENT_QUOTES, 'UTF-8') ?>'>
                                    <?= ($client['client_type'] == 'legal' ? "[H] " . $client['company_name'] : "[F] " . $client['fullname']) ?>
                                </option>
                            <?php endforeach; ?>
                        </select>
                    </div>
                    <button class="btn btn-grm btn-sm py-2 fw-bold"><a href="index.php" style="color: white; text-decoration: none;">Əsas səhifə</a></button>

                    <ul class="nav nav-pills mb-4 justify-content-center">
                        <li class="nav-item">
                            <button type="button" class="nav-link active rounded-pill" id="tab-phys" onclick="setType('physical')">Fiziki şəxs</button>
                        </li>
                        <li class="nav-item ms-2">
                            <button type="button" class="nav-link rounded-pill" id="tab-legal" onclick="setType('legal')">Hüquqi şəxs</button>
                        </li>
                    </ul>
                    
                    <input type="hidden" name="person_type" id="p_type" value="physical">

                    <div class="row g-4">
                        <!-- Основная информация -->
                        <div class="col-md-6 border-end">
                            <div class="section-title">Ümumi məlumat</div>
                            
                            <label>Müqavilə tarixi (Bu gün)</label>
                            <input type="text" name="date" class="form-control form-control-sm" value="<?= date('d.m.Y') ?>">

                            <div id="box-physical">
                                <label>Soyadı Adı Ata adı</label>
                                <input type="text" name="full_name" id="field_full_name" class="form-control form-control-sm" placeholder="Əliyev Əli Əli oğlu">
                            </div>

                            <div id="box-legal" style="display:none;">
                                <label>Şirkətin adı</label>
                                <input type="text" name="company_name" id="field_company_name" class="form-control form-control-sm" placeholder="EMPEROR GROUP MMC">
                                
                                <div class="row g-2">
                                    <div class="col-4">
                                        <label>Dir. Soyadı</label>
                                        <input type="text" name="dir_surname" id="field_dir_surname" class="form-control form-control-sm">
                                    </div>
                                    <div class="col-4">
                                        <label>Dir. Adı</label>
                                        <input type="text" name="dir_name" id="field_dir_name" class="form-control form-control-sm">
                                    </div>
                                    <div class="col-4">
                                        <label>Dir. Ata adı</label>
                                        <input type="text" name="dir_patronymic" id="field_dir_patronymic" class="form-control form-control-sm">
                                    </div>
                                </div>
                            </div>

                            <label>VÖEN</label>
                            <input type="text" name="voen" id="field_voen" class="form-control form-control-sm" placeholder="XXXXXXXXXX">
                            
                            <div class="row g-2">
                                <div class="col-6">
                                    <label>Müqavilə №</label>
                                    <input type="text" name="contract_num" class="form-control form-control-sm" placeholder="GRM-EMP-001">
                                </div>
                                <div class="col-6">
                                    <label>İmzalanma tarixi</label>
                                    <input type="text" name="contract_date" class="form-control form-control-sm" placeholder="dd.mm.yyyy">
                                </div>
                            </div>
                            <small class="text-muted d-block mt-2" style="font-size: 0.6rem;">* Bitiş tarixi +1 il olaraq avtomatik hesablanır.</small>
                        </div>

                        <!-- Реквизиты -->
                        <div class="col-md-6">
                            <div class="section-title">Bank Rekvizitləri</div>
                            
                            <label>Bankın adı</label>
                            <input type="text" name="bank_name" id="field_bank_name" class="form-control form-control-sm">

                            <div class="row g-2">
                                <div class="col-6"><label>Filial kodu</label><input type="text" name="branch_code" id="field_branch_code" class="form-control form-control-sm"></div>
                                <div class="col-6"><label>Bank VÖEN</label><input type="text" name="bank_voen" id="field_bank_voen" class="form-control form-control-sm"></div>
                            </div>

                            <div class="row g-2">
                                <div class="col-6"><label>SWIFT</label><input type="text" name="swift" id="field_swift" class="form-control form-control-sm"></div>
                                <div class="col-6"><label>Müxbir hesab</label><input type="text" name="m_account" id="field_m_account" class="form-control form-control-sm"></div>
                            </div>

                            <label>Benefisiarın hesabı (AZN)</label>
                            <input type="text" name="beneficiary_account" id="field_beneficiary_account" class="form-control form-control-sm">

                            <label>Benefisiarın VÖEN-i</label>
                            <input type="text" name="beneficiary_voen" id="field_beneficiary_voen" class="form-control form-control-sm">
                        </div>
                    </div>

                    <div class="row g-3 mt-4">
                        <div class="col-md-8">
                            <button type="submit" name="generate" class="btn btn-generate w-100 shadow-sm text-uppercase">
                                Müqaviləni yarat (.docx)
                            </button>
                        </div>
                        <div class="col-md-4">
                            <a href="konsalting.php" class="btn btn-outline-secondary w-100 shadow-sm">Sıfırla</a>
                        </div>
                    </div>
                </form>
            </div>
            
            <p class="text-center mt-4 text-muted small">GRM Group Co. &copy; 2026 | Baku, Azerbaijan</p>
        </div>
    </div>
</div>

<script>
function setType(type) {
    document.getElementById('p_type').value = type;
    const physBox = document.getElementById('box-physical');
    const legalBox = document.getElementById('box-legal');
    
    if(type === 'physical') {
        physBox.style.display = 'block';
        legalBox.style.display = 'none';
        document.getElementById('tab-phys').classList.add('active');
        document.getElementById('tab-legal').classList.remove('active');
    } else {
        physBox.style.display = 'none';
        legalBox.style.display = 'block';
        document.getElementById('tab-phys').classList.remove('active');
        document.getElementById('tab-legal').classList.add('active');
    }
}

function autoFillClient() {
    const select = document.getElementById('db_client_select');
    if (!select.value) return;

    const data = JSON.parse(select.value);
    
    // Переключаем тип формы
    setType(data.client_type);

    // Заполнение имен
    if (data.client_type === 'physical') {
        document.getElementById('field_full_name').value = data.fullname || '';
    } else {
        document.getElementById('field_company_name').value = data.company_name || '';
        
        // Разбиваем fullname на Ф.И.О для директора (если в базе "Əliyev Əli Vəli")
        const nameParts = (data.fullname || '').split(' ');
        document.getElementById('field_dir_surname').value = nameParts[0] || '';
        document.getElementById('field_dir_name').value = nameParts[1] || '';
        document.getElementById('field_dir_patronymic').value = nameParts.slice(2).join(' ') || '';
    }
    
    // Заполнение реквизитов
    document.getElementById('field_voen').value = data.voen || '';
    document.getElementById('field_bank_name').value = data.bank_name || '';
    document.getElementById('field_branch_code').value = data.branch_code || '';
    document.getElementById('field_bank_voen').value = data.bank_voen || '';
    document.getElementById('field_swift').value = data.swift || '';
    document.getElementById('field_m_account').value = data.m_account || '';
    document.getElementById('field_beneficiary_account').value = data.beneficiary_account || '';
    document.getElementById('field_beneficiary_voen').value = data.beneficiary_voen || '';
}
</script>

</body>
</html>