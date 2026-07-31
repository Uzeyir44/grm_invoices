<?php
session_start();
if (!isset($_SESSION['user_id'])) {
    header("Location: login.php");
    exit;
}

// 1. Подключение зависимостей и базы данных
require_once __DIR__ . '/../vendor/autoload.php';
require_once 'db.php'; 

use Grm\DocGenerator;

$message = "";

// --- Получение списка компаний из базы grm_crm ---
try {
    $companies = $pdo->query("SELECT * FROM clients ORDER BY company_name ASC")->fetchAll(PDO::FETCH_ASSOC);
} catch (Exception $e) {
    $companies = []; 
}

// 2. Обработка генерации акта
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['generate'])) {
    try {
        $type = $_POST['client_type'] ?? 'legal';
        
        // Выбор шаблона
        $template = ($type === 'physical') ? 'tahvil_fiziki.docx' : 'tahvil_huquqi.docx';
        
        // Формирование имени выходного файла
        $contractNum = !empty($_POST['contract_num']) ? $_POST['contract_num'] : time();
        $outputFileName = 'Tahvil_Taslim_Akt_No' . $contractNum;

        $formData = $_POST;
        
        if (isset($_POST['item_name']) && is_array($_POST['item_name'])) {
            
            $templatePath = __DIR__ . '/../templates/' . $template; 
            if (file_exists($templatePath)) {
                $templateProcessor = new \PhpOffice\PhpWord\TemplateProcessor($templatePath);
                
                $rowCount = count($_POST['item_name']);
                
                // --- Цикл по всем трем таблицам документа ---
                for ($t = 1; $t <= 3; $t++) {
                    $templateProcessor->cloneRow('item_name' . $t, $rowCount);
                    
                    for ($i = 0; $i < $rowCount; $i++) {
                        $rowNum = $i + 1;
                        $templateProcessor->setValue('ss' . $t . '#' . $rowNum, $rowNum);
                        $templateProcessor->setValue('item_name' . $t . '#' . $rowNum, htmlspecialchars($_POST['item_name'][$i] ?? '', ENT_QUOTES, 'UTF-8'));
                        $templateProcessor->setValue('item_qty' . $t . '#' . $rowNum, htmlspecialchars($_POST['item_qty'][$i] ?? '1', ENT_QUOTES, 'UTF-8'));
                        $templateProcessor->setValue('item_price' . $t . '#' . $rowNum, htmlspecialchars($_POST['item_price'][$i] ?? '0.00', ENT_QUOTES, 'UTF-8'));
                        $templateProcessor->setValue('item_total' . $t . '#' . $rowNum, htmlspecialchars($_POST['item_total'][$i] ?? '0.00', ENT_QUOTES, 'UTF-8'));
                    }
                }
                
                // --- Автоматический расчет или подстановка invoice_date_final ---
                if (!empty($_POST['invoice_date_final_input'])) {
                    // Если пользователь заполнил поле вручную — берем его значение
                    $invoiceDateFinal = $_POST['invoice_date_final_input'];
                } else {
                    // Если поле осталось пустым — рассчитываем автоматически (минус 3 дня от invoice_date)
                    $invoiceDateStr = $_POST['invoice_date'] ?? date('d.m.Y');
                    $invoiceDateFinal = $invoiceDateStr;
                    $dateObj = DateTime::createFromFormat('d.m.Y', $invoiceDateStr);
                    if ($dateObj) {
                        $dateObj->modify('-3 days');
                        $invoiceDateFinal = $dateObj->format('d.m.Y');
                    }
                }
                $templateProcessor->setValue('invoice_date_final', htmlspecialchars($invoiceDateFinal, ENT_QUOTES, 'UTF-8'));
                
                // --- Привязка ФИО директора (с авто-разбиением, если скрытые поля пусты) ---
                $dir_surname = $_POST['dir_surname'] ?? '';
                $dir_name = $_POST['dir_name'] ?? '';
                $dir_patronymic = $_POST['dir_patronymic'] ?? '';

                if (empty($dir_surname) && empty($dir_name) && !empty($_POST['full_name'])) {
                    $nameParts = explode(' ', trim(preg_replace('/\s+/', ' ', $_POST['full_name'])));
                    $dir_surname = $nameParts[0] ?? '';
                    $dir_name = $nameParts[1] ?? '';
                    $dir_patronymic = isset($nameParts[2]) ? implode(' ', array_slice($nameParts, 2)) : '';
                }

                $templateProcessor->setValue('dir_surname', htmlspecialchars($dir_surname, ENT_QUOTES, 'UTF-8'));
                $templateProcessor->setValue('dir_name', htmlspecialchars($dir_name, ENT_QUOTES, 'UTF-8'));
                $templateProcessor->setValue('dir_patronymic', htmlspecialchars($dir_patronymic, ENT_QUOTES, 'UTF-8'));

                // --- Фикс капризного invoice_num ---
                $invoiceNum = $_POST['invoice_num'] ?? '1';
                $templateProcessor->setValue('invoice_num', htmlspecialchars($invoiceNum, ENT_QUOTES, 'UTF-8'));
                $templateProcessor->setValue('$invoice_num', htmlspecialchars($invoiceNum, ENT_QUOTES, 'UTF-8')); 

                // --- Подстановка номера счета (Hesab №) ---
                $accountNum = $_POST['account_num'] ?? '';
                $templateProcessor->setValue('account_num', htmlspecialchars($accountNum, ENT_QUOTES, 'UTF-8'));

                // Заполняем все остальные одиночные теги
                foreach ($formData as $key => $value) {
                    if (!is_array($value)) {
                        $templateProcessor->setValue($key, htmlspecialchars($value ?? '', ENT_QUOTES, 'UTF-8'));
                    }
                }
                
                // Переключатель текста ƏDV
                if (isset($_POST['edv_text_label'])) {
                    $templateProcessor->setValue('edv_text_label', htmlspecialchars($_POST['edv_text_label'], ENT_QUOTES, 'UTF-8'));
                }
                
                // Сохранение
                $uploadDir = __DIR__ . '/uploads/';
                if (!file_exists($uploadDir)) {
                    mkdir($uploadDir, 0777, true);
                }
                
                $finalFileName = $outputFileName . '.docx';
                $templateProcessor->saveAs($uploadDir . $finalFileName);
                $file = $finalFileName;
            } else {
                throw new Exception("Şablon tapılmadı: " . $template);
            }
        } else {
            $file = DocGenerator::generate($template, $_POST, $outputFileName);
        }
        
        $message = "
        <div class='alert alert-success border-0 shadow-sm text-center'>
            <strong>Uğurlu əməliyyat!</strong> Sənəd hazırlandı.<br>
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
    <title>GRM Group Co. - Təhvil-təslim Aktı</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <style>
        body { background-color: #c0dce3; font-family: 'Segoe UI', sans-serif; }
        .card { border-radius: 15px; border: none; box-shadow: 0 10px 30px rgba(0,0,0,0.1); }
        .section-title { font-size: 0.85rem; font-weight: 700; color: #047590; text-transform: uppercase; border-bottom: 2px solid #eee; padding-bottom: 5px; margin-bottom: 15px; }
        .btn-grm { background: #047590; color: white; transition: 0.3s; }
        .btn-grm:hover { background: #035b71; color: white; transform: translateY(-2px); }
        label { font-size: 0.75rem; font-weight: 600; color: #444; margin-top: 10px; }
        .form-control-sm, .form-select-sm { border-radius: 8px; }
        .btn-generate { background: #047590; color: white; border: none; padding: 12px; font-weight: 600; }
        .btn-generate:hover { background: #035b71; color: white; }
        .remove-row { color: #dc3545; cursor: pointer; font-weight: bold; font-size: 1.2rem; }
        .client-selector-box { background: #f8f9fa; border: 2px dashed #047590; border-radius: 10px; padding: 15px; margin-bottom: 20px; }
        .badge-type { font-size: 0.65rem; padding: 4px 8px; border-radius: 6px; text-transform: uppercase; }
        .edv-switcher { background: #edf7f9; border: 1px solid #bce1e9; border-radius: 10px; padding: 12px; margin-bottom: 15px; }
    </style>
</head>
<body>

<div class="container py-5">
    <div class="row justify-content-center">
        <div class="col-lg-11">
            <div class="text-center mb-4">
                <h2 class="fw-bold" style="color: #047590;">TƏHVİL-TƏSLİM AKTI</h2>
                <p class="text-muted small text-uppercase">GRM Group Co. Sənəd Hazırlama Sistemi</p>
            </div>

            <?= $message ?>

            <div class="card p-4 mt-3">
                <form method="POST" id="aktForm">
                    <input type="hidden" name="client_type" id="client_type" value="legal">
                    
                    <input type="hidden" name="dir_surname" id="c_dir_surname">
                    <input type="hidden" name="dir_name" id="c_dir_name">
                    <input type="hidden" name="dir_patronymic" id="c_dir_patronymic">

                    <div class="row g-4">
                        <div class="col-md-4 border-end">
                            <div class="client-selector-box">
                                <label class="mt-0 text-primary" style="font-size: 0.65rem;">Müştəri bazasından seçin</label>
                                <select id="db_client_select" class="form-select form-select-sm mt-1" onchange="autoFillAktClient()">
                                    <option value="">-- Yeni Müştəri --</option>
                                    <?php foreach ($companies as $client): ?>
                                        <option value='<?= base64_encode(json_encode($client, JSON_UNESCAPED_UNICODE)) ?>'>
                                            <?= htmlspecialchars($client['client_type'] == 'legal' ? $client['company_name'] : $client['fullname'], ENT_QUOTES, 'UTF-8') ?>
                                        </option>
                                    <?php endforeach; ?>
                                </select>
                            </div>
                            
                            <div class="edv-switcher">
                                <div class="form-check form-switch mb-0">
                                    <input class="form-check-input" type="checkbox" id="is_edv" name="is_edv" value="1" checked onchange="calculateAktTotal()">
                                    <label class="form-check-label fw-bold text-dark mt-0" for="is_edv" style="font-size: 0.8rem; cursor:pointer;">ƏDV Ödəyicisiyəm (18% ƏDV)</label>
                                </div>
                            </div>

                            <button type="button" class="btn btn-grm btn-sm py-2 fw-bold"><a href="index.php" style="color: white; text-decoration: none;">Əsas səhifə</a></button>

                            <div class="section-title d-flex justify-content-between align-items-center mt-3">
                                Tərəflər
                                <span id="status_badge" class="badge bg-info badge-type">Hüquqi</span>
                            </div>
                            
                            <label>Müqavilə №</label>
                            <input type="text" name="contract_num" class="form-control form-control-sm" placeholder="GRM-EMP-001">
                            
                            <label>Müqavilə tarixi</label>
                            <input type="text" name="contract_date" class="form-control form-control-sm" placeholder="dd.mm.yyyy">

                            <div id="company_name_div">
                                <label>Şirkətin adı</label>
                                <input type="text" name="company_name" id="c_name" class="form-control form-control-sm">
                            </div>

                            <label id="label_person">Direktor / Fiziki şəxs (S.A.A)</label>
                            <input type="text" name="full_name" id="c_person" class="form-control form-control-sm">
                            
                            <label>VÖEN</label>
                            <input type="text" name="voen" id="c_voen" class="form-control form-control-sm" placeholder="XXXXXXXXXX">

                            <label>Ünvan</label>
                            <input type="text" name="address" id="c_address" class="form-control form-control-sm">

                            <label>Əlaqə nömrəsi</label>
                            <input type="text" name="phone" id="c_phone" class="form-control form-control-sm" placeholder="+994XXXXXXXXX">
                        </div>

                        <div class="col-md-8">
                            <div class="section-title">Görülmüş işlərin siyahısı</div>
                            
                            <div class="row g-2 mb-4">
                                <div class="col-md-3">
                                    <label>Akt / Əlavə №</label>
                                    <input type="text" name="invoice_num" class="form-control form-control-sm" placeholder="1" value="1">
                                </div>
                                <div class="col-md-3">
                                    <label>Hesab (Hesab №)</label>
                                    <input type="text" name="account_num" class="form-control form-control-sm" placeholder="PRA-CAS-26/04-001">
                                </div>
                                <div class="col-md-3">
                                    <label>Qaimə tarixi</label>
                                    <input type="text" name="invoice_date" class="form-control form-control-sm" value="<?= date('d.m.Y') ?>">
                                </div>
                                <div class="col-md-3">
                                    <label>Sifariş tarixi</label>
                                    <input type="text" name="invoice_date_final_input" class="form-control form-control-sm" placeholder="Boşdursa: -3 gün">
                                </div>
                            </div>

                            <div class="table-responsive">
                                <table class="table table-sm align-middle" id="itemsTable">
                                    <thead class="bg-light small text-uppercase">
                                        <tr>
                                            <th style="width: 50%;">Xidmətin adı</th>
                                            <th style="width: 10%;">Say</th>
                                            <th style="width: 20%;">Qiymət</th>
                                            <th style="width: 20%;">Cəmi</th>
                                            <th></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr>
                                            <td><input type="text" name="item_name[]" class="form-control form-control-sm" required></td>
                                            <td><input type="number" name="item_qty[]" class="form-control form-control-sm qty" value="1" oninput="calculateAktRow(this)"></td>
                                            <td><input type="number" step="0.0001" name="item_price[]" class="form-control form-control-sm price" oninput="calculateAktRow(this)"></td>
                                            <td><input type="text" name="item_total[]" class="form-control form-control-sm total" readonly value="0.00"></td>
                                            <td></td>
                                        </tr>
                                    </tbody>
                                </table>
                                <button type="button" class="btn btn-sm btn-link text-decoration-none p-0" onclick="addAktRow()">+ Yeni sətir əlavə et</button>
                            </div>

                            <div class="row justify-content-end mt-4">
                                <div class="col-md-6">
                                    <div class="p-3 rounded bg-light border shadow-sm">
                                        <div class="d-flex justify-content-between small mb-1">
                                            <span>Məbləğ:</span>
                                            <span class="fw-bold"><span id="subtotal">0.00</span> AZN</span>
                                            <input type="hidden" name="final_subtotal" id="h_subtotal" value="0.00">
                                        </div>
                                        <div class="d-flex justify-content-between small mb-1 text-muted">
                                            <span id="edv_label_text">ƏDV (18%):</span>
                                            <span><span id="tax">0.00</span> AZN</span>
                                            <input type="hidden" name="final_tax" id="h_tax" value="0.00">
                                            <input type="hidden" name="edv_text_label" id="h_edv_text_label" value="ƏDV 18%">
                                        </div>
                                        <hr class="my-2">
                                        <div class="d-flex justify-content-between align-items-center">
                                            <span class="fw-bold">YEKUN:</span>
                                            <span class="h5 mb-0 fw-bold text-primary"><span id="grandTotal">0.00</span> AZN</span>
                                            <input type="hidden" name="final_grand_total" id="h_grandtotal" value="0.00">
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="row g-3 mt-4">
                        <div class="col-md-12">
                            <button type="submit" name="generate" class="btn btn-generate w-100 shadow-sm text-uppercase">Təhvil-təslim Aktını Hazırla</button>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    </div>
</div>

<script>
function autoFillAktClient() {
    const select = document.getElementById('db_client_select');
    const badge = document.getElementById('status_badge');
    const companyDiv = document.getElementById('company_name_div');

    if (!select.value) {
        document.getElementById('aktForm').reset();
        badge.innerText = 'Hüquqi';
        badge.className = 'badge bg-info badge-type';
        companyDiv.style.display = 'block';
        calculateAktTotal();
        return;
    }

    try {
        const binaryString = atob(select.value);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        const decodedData = new TextDecoder('utf-8').decode(bytes);
        
        const data = JSON.parse(decodedData);
        const type = data.client_type || 'legal';
        
        document.getElementById('client_type').value = type;

        if (type === 'physical') {
            badge.innerText = 'Fiziki';
            badge.className = 'badge bg-warning badge-type text-dark';
            companyDiv.style.display = 'none';
            document.getElementById('label_person').innerText = 'Fiziki şəxs (A.S.A)';
        } else {
            badge.innerText = 'Hüquqi';
            badge.className = 'badge bg-info badge-type';
            companyDiv.style.display = 'block';
            document.getElementById('label_person').innerText = 'Direktor (A.S.A)';
        }

        document.getElementById('c_name').value = data.company_name || '';
        document.getElementById('c_person').value = data.fullname || '';
        document.getElementById('c_voen').value = data.voen || data.beneficiary_voen || '';
        document.getElementById('c_address').value = data.address || '';
        document.getElementById('c_phone').value = data.phone || '';
        
        document.getElementById('c_dir_surname').value = data.dir_surname || ''; 
        document.getElementById('c_dir_name').value = data.dir_name || '';
        document.getElementById('c_dir_patronymic').value = data.dir_patronymic || '';
        
        calculateAktTotal();
    } catch(e) {
        console.error("Müştəri məlumatlarının oxunmasında xəta baş verdi:", e);
    }
}

function addAktRow() {
    const tbody = document.querySelector('#itemsTable tbody');
    const row = document.createElement('tr');
    row.innerHTML = `
        <td><input type="text" name="item_name[]" class="form-control form-control-sm" required></td>
        <td><input type="number" name="item_qty[]" class="form-control form-control-sm qty" value="1" oninput="calculateAktRow(this)"></td>
        <td><input type="number" step="0.0001" name="item_price[]" class="form-control form-control-sm price" oninput="calculateAktRow(this)"></td>
        <td><input type="text" name="item_total[]" class="form-control form-control-sm total" readonly value="0.00"></td>
        <td class="text-center"><span class="remove-row" onclick="this.closest('tr').remove(); calculateAktTotal();">×</span></td>
    `;
    tbody.appendChild(row);
}

function calculateAktRow(el) {
    const row = el.closest('tr');
    const qty = parseFloat(row.querySelector('.qty').value) || 0;
    const price = parseFloat(row.querySelector('.price').value) || 0;
    const total = qty * price;
    row.querySelector('.total').value = total.toFixed(2);
    calculateAktTotal();
}

function calculateAktTotal() {
    let subtotal = 0;
    document.querySelectorAll('.total').forEach(input => {
        subtotal += parseFloat(input.value) || 0;
    });

    const edvSwitch = document.getElementById('is_edv');
    let tax = 0;
    
    if (edvSwitch.checked) {
        tax = subtotal * 0.18;
        document.getElementById('edv_label_text').innerText = "ƏDV (18%):";
        document.getElementById('h_edv_text_label').value = "ƏDV 18%";
    } else {
        tax = 0;
        document.getElementById('edv_label_text').innerText = "ƏDV (0%):";
        document.getElementById('h_edv_text_label').value = "ƏDV-dən azad"; 
    }
    
    const grand = subtotal + tax;

    document.getElementById('subtotal').innerText = subtotal.toFixed(2);
    document.getElementById('tax').innerText = tax.toFixed(2);
    document.getElementById('grandTotal').innerText = grand.toFixed(2);

    document.getElementById('h_subtotal').value = subtotal.toFixed(2);
    document.getElementById('h_tax').value = tax.toFixed(2);
    document.getElementById('h_grandtotal').value = grand.toFixed(2);
}
</script>

</body>
</html>