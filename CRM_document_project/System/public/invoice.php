<?php
session_start();
if (!isset($_SESSION['user_id'])) {
    header("Location: login.php");
    exit;
}
// 1. Подключение зависимостей и БД
require_once __DIR__ . '/../vendor/autoload.php';
require_once 'db.php'; 

use Grm\DocGenerator;

$message = "";

// --- Получение списка компаний для автозаполнения ---
try {
    $companies = $pdo->query("SELECT * FROM clients ORDER BY company_name ASC")->fetchAll(PDO::FETCH_ASSOC);
} catch (Exception $e) {
    $companies = []; 
}

// 2. Обработка генерации инвойса
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['generate'])) {
    try {
        $invoiceNum = !empty($_POST['invoice_num']) ? $_POST['invoice_num'] : time();
        $outputFileName = 'İnvoys_No_' . $invoiceNum;
        
        $templatePath = __DIR__ . '/../templates/invoice_template.docx'; 
        
        if (file_exists($templatePath)) {
            // Настройка глобальной локали для корректной обработки строк
            setlocale(LC_ALL, 'az_AZ.UTF-8', 'az_AZ', 'azerbaijani');
            
            $templateProcessor = new \PhpOffice\PhpWord\TemplateProcessor($templatePath);
            
            // Динамическое клонирование строк таблицы товаров
            if (isset($_POST['item_name']) && is_array($_POST['item_name'])) {
                $rowCount = count($_POST['item_name']);
                $templateProcessor->cloneRow('item_name', $rowCount);
                
                for ($i = 0; $i < $rowCount; $i++) {
                    $rowNum = $i + 1;
                    
                    // Безопасное приведение к UTF-8 для динамических строк таблицы
                    $itemNameClean = htmlspecialchars($_POST['item_name'][$i] ?? '', ENT_QUOTES, 'UTF-8');
                    $itemQtyClean  = htmlspecialchars($_POST['item_qty'][$i] ?? '1', ENT_QUOTES, 'UTF-8');
                    $itemPriceClean = htmlspecialchars($_POST['item_price'][$i] ?? '0.00', ENT_QUOTES, 'UTF-8');
                    $itemTotalClean = htmlspecialchars($_POST['item_total'][$i] ?? '0.00', ENT_QUOTES, 'UTF-8');

                    $templateProcessor->setValue('ss#' . $rowNum, $rowNum);
                    $templateProcessor->setValue('item_name#' . $rowNum, $itemNameClean);
                    $templateProcessor->setValue('item_qty#' . $rowNum, $itemQtyClean);
                    $templateProcessor->setValue('item_price#' . $rowNum, $itemPriceClean);
                    $templateProcessor->setValue('item_total#' . $rowNum, $itemTotalClean);
                }
            }
            
            // Текст для отображения статуса НДС в самом документе (поддерживаем оба варианта тегов)
            $taxRateText = ($_POST['tax_rate'] === '0') ? "ƏDV-dən azad" : "ƏDV (18%)";
            $templateProcessor->setValue('tax_rate_text', $taxRateText);
            
            // Заполнение одиночных тегов (компания, воэн, даты, итоги, заметки)
            foreach ($_POST as $key => $value) {
                if (!is_array($value)) {
                    // Очистка и приведение каждого одиночного поля к валидному UTF-8
                    $cleanValue = htmlspecialchars($value ?? '', ENT_QUOTES, 'UTF-8');
                    $templateProcessor->setValue($key, $cleanValue);
                }
            }
            
            $uploadDir = __DIR__ . '/uploads/';
            if (!file_exists($uploadDir)) {
                mkdir($uploadDir, 0777, true);
            }
            
            $finalFileName = $outputFileName . '.docx';
            $templateProcessor->saveAs($uploadDir . $finalFileName);
            
            $message = "
            <div class='alert alert-success border-0 shadow-sm text-center'>
                <strong>Uğurlu əməliyyat!</strong> İnvoys hazırlandı.<br>
                <a href='uploads/$finalFileName' class='btn btn-grm btn-sm mt-2 fw-bold text-white text-decoration-none'>Yüklə .docx</a>
            </div>";
        } else {
            throw new Exception("Şablon tapılmadı: invoice_template.docx");
        }
        
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
    <title>GRM Group Co. - Invoice System</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <style>
        body { background-color: #c0dce3; font-family: 'Segoe UI', sans-serif; }
        .card { border-radius: 15px; border: none; box-shadow: 0 10px 30px rgba(0,0,0,0.1); }
        .section-title { font-size: 0.85rem; font-weight: 700; color: #047590; text-transform: uppercase; border-bottom: 2px solid #eee; padding-bottom: 5px; margin-bottom: 15px; }
        .btn-grm { background: #047590; color: white; transition: 0.3s; padding: 6px 15px; border-radius: 8px; }
        .btn-grm:hover { background: #035b71; color: white; transform: translateY(-2px); }
        label { font-size: 0.75rem; font-weight: 600; color: #444; margin-top: 10px; }
        .form-control-sm, .form-select-sm { border-radius: 8px; }
        .btn-generate { background: #047590; color: white; border: none; padding: 12px; font-weight: 600; border-radius: 8px; }
        .btn-generate:hover { background: #035b71; color: white; }
        .remove-row { color: #dc3545; cursor: pointer; font-weight: bold; font-size: 1.2rem; }
        .client-selector-box { background: #f8f9fa; border: 2px dashed #047590; border-radius: 10px; padding: 15px; margin-bottom: 20px; }
    </style>
</head>
<body>

<div class="container py-5">
    <div class="row justify-content-center">
        <div class="col-lg-11">
            <div class="text-center mb-4">
                <h2 class="fw-bold" style="color: #047590;">İNVOYS GENERATOR</h2>
                <p class="text-muted small text-uppercase">GRM Group Co. İdarəetmə Paneli</p>
            </div>

            <?= $message ?>

            <div class="card p-4 mt-3">
                <form method="POST" id="invoiceForm">
                    
                    <div class="row g-4">
                        <div class="col-md-4 border-end">
                            <div class="client-selector-box">
                                <label class="mt-0 text-primary text-uppercase" style="font-size: 0.65rem;">Müştəri bazasından seçin</label>
                                <select id="db_client_select" class="form-select form-select-sm mt-1" onchange="autoFillInvoiceClient()">
                                    <option value="">-- Yeni Müştəri --</option>
                                    <?php foreach ($companies as $client): ?>
                                        <option value='<?= base64_encode(json_encode($client, JSON_UNESCAPED_UNICODE)) ?>'>
                                            <?= htmlspecialchars($client['client_type'] == 'legal' ? $client['company_name'] : $client['fullname'], ENT_QUOTES, 'UTF-8') ?>
                                        </option>
                                    <?php endforeach; ?>
                                </select>
                            </div>
                            <div class="mb-3">
                                <a href="index.php" class="btn btn-grm btn-sm fw-bold text-white text-decoration-none">Əsas səhifə</a>
                            </div>

                            <div class="section-title">Müştəri Məlumatları</div>
                            
                            <label>Şirkətin adı / S.A.A</label>
                            <input type="text" name="company_name" id="c_name" class="form-control form-control-sm" required>
                            
                            <label>VÖEN</label>
                            <input type="text" name="voen" id="c_voen" class="form-control form-control-sm" placeholder="XXXXXXXXXX">

                            <label>Ünvan</label>
                            <input type="text" name="address" id="c_address" class="form-control form-control-sm">

                            <label>Əlaqə nömrəsi</label>
                            <input type="text" name="phone" id="c_phone" class="form-control form-control-sm" placeholder="+994XXXXXXXXX">
                        </div>

                        <div class="col-md-8">
                            <div class="section-title">İnvoysun detalları</div>
                            
                            <div class="row g-2 mb-4">
                                <div class="col-md-3">
                                    <label>İnvoys №</label>
                                    <input type="text" name="invoice_num" class="form-control form-control-sm" placeholder="GRM-EMP-001">
                                </div>
                                <div class="col-md-3">
                                    <label>Tarix</label>
                                    <input type="text" name="invoice_date" class="form-control form-control-sm" value="<?= date('d.m.Y') ?>">
                                </div>
                                <div class="col-md-3">
                                    <label>Vergi növü (ƏDV)</label>
                                    <select name="tax_rate" id="tax_rate" class="form-select form-select-sm" onchange="calculateTotal()">
                                        <option value="18">ƏDV 18%</option>
                                        <option value="0">ƏDV-dən azad (0%)</option>
                                    </select>
                                </div>
                                <div class="col-md-3">
                                    <label>Ödəniş növü</label>
                                    <select name="payment_method" class="form-select form-select-sm">
                                        <option value="Köçürmə yolu ilə">Köçürmə</option>
                                        <option value="Nağd">Nağd</option>
                                    </select>
                                </div>
                            </div>

                            <div class="table-responsive">
                                <table class="table table-sm align-middle" id="itemsTable">
                                    <thead class="bg-light small text-uppercase">
                                        <tr>
                                            <th style="width: 45%;">Xidmətin / Malın adı</th>
                                            <th style="width: 15%;">Miqdar</th>
                                            <th style="width: 20%;">Qiymət</th>
                                            <th style="width: 20%;">Cəmi</th>
                                            <th></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr>
                                            <td><input type="text" name="item_name[]" class="form-control form-control-sm" required></td>
                                            <td><input type="number" name="item_qty[]" class="form-control form-control-sm qty" value="1" oninput="calculateRow(this)"></td>
                                            <td><input type="number" step="0.0001" name="item_price[]" class="form-control form-control-sm price" oninput="calculateRow(this)"></td>
                                            <td><input type="text" name="item_total[]" class="form-control form-control-sm total" readonly value="0.00"></td>
                                            <td></td>
                                        </tr>
                                    </tbody>
                                </table>
                                <button type="button" class="btn btn-sm btn-link text-decoration-none p-0" onclick="addRow()">+ Yeni sətir</button>
                            </div>

                            <div class="row justify-content-end mt-4">
                                <div class="col-md-6">
                                    <div class="p-3 rounded bg-light border">
                                        <div class="d-flex justify-content-between small mb-1">
                                            <span>Məbləğ:</span>
                                            <span class="fw-bold"><span id="subtotal">0.00</span> AZN</span>
                                            <input type="hidden" name="final_subtotal" id="h_subtotal" value="0.00">
                                        </div>
                                        <div class="d-flex justify-content-between small mb-1 text-muted">
                                            <span id="tax_label">ƏDV (18%):</span>
                                            <span><span id="tax">0.00</span> AZN</span>
                                            <input type="hidden" name="final_tax" id="h_tax" value="0.00">
                                            <input type="hidden" name="edv_text_label" id="h_tax_label" value="ƏDV (18%):">
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

                    <div class="row mt-4">
                        <div class="col-12">
                            <label>Əlavə qeydlər</label>
                            <textarea name="notes" class="form-control" rows="2" placeholder="Məsələn: Ödəniş 3 iş günü ərzində edilməlidir."></textarea>
                        </div>
                    </div>

                    <div class="row g-3 mt-4">
                        <div class="col-md-8">
                            <button type="submit" name="generate" class="btn btn-generate w-100 shadow-sm text-uppercase">İnvoysu Hazırla (.docx)</button>
                        </div>
                        <div class="col-md-4">
                            <button type="reset" class="btn btn-outline-secondary w-100" onclick="window.location.reload();">Sıfırla</button>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    </div>
</div>

<script>
function autoFillInvoiceClient() {
    const select = document.getElementById('db_client_select');
    if (!select.value) {
        document.getElementById('invoiceForm').reset();
        return;
    }

    try {
        const decodedData = decodeURIComponent(escape(atob(select.value)));
        const data = JSON.parse(decodedData);
        
        document.getElementById('c_name').value = (data.client_type === 'legal' ? data.company_name : data.fullname) || '';
        document.getElementById('c_voen').value = data.voen || data.beneficiary_voen || '';
        document.getElementById('c_address').value = data.address || '';
        document.getElementById('c_phone').value = data.phone || '';
    } catch (e) {
        try {
            const decodedData = atob(select.value);
            const data = JSON.parse(decodedData);
            document.getElementById('c_name').value = (data.client_type === 'legal' ? data.company_name : data.fullname) || '';
            document.getElementById('c_voen').value = data.voen || data.beneficiary_voen || '';
            document.getElementById('c_address').value = data.address || '';
            document.getElementById('c_phone').value = data.phone || '';
        } catch (err) {
            console.error("Xəta baş verdi:", err);
        }
    }
}

function addRow() {
    const tbody = document.querySelector('#itemsTable tbody');
    const row = document.createElement('tr');
    row.innerHTML = `
        <td><input type="text" name="item_name[]" class="form-control form-control-sm" required></td>
        <td><input type="number" name="item_qty[]" class="form-control form-control-sm qty" value="1" oninput="calculateRow(this)"></td>
        <td><input type="number" step="0.0001" name="item_price[]" class="form-control form-control-sm price" oninput="calculateRow(this)"></td>
        <td><input type="text" name="item_total[]" class="form-control form-control-sm total" readonly value="0.00"></td>
        <td class="text-center"><span class="remove-row" onclick="this.closest('tr').remove(); calculateTotal();">×</span></td>
    `;
    tbody.appendChild(row);
}

function calculateRow(el) {
    const row = el.closest('tr');
    const qty = parseFloat(row.querySelector('.qty').value) || 0;
    const price = parseFloat(row.querySelector('.price').value) || 0;
    const total = qty * price;
    row.querySelector('.total').value = total.toFixed(2);
    calculateTotal();
}

function calculateTotal() {
    let subtotal = 0;
    document.querySelectorAll('.total').forEach(input => {
        subtotal += parseFloat(input.value) || 0;
    });

    const taxRate = parseFloat(document.getElementById('tax_rate').value) || 0;
    const taxLabel = document.getElementById('tax_label');
    const hiddenTaxLabel = document.getElementById('h_tax_label');
    
    let tax = 0;
    if (taxRate > 0) {
        tax = subtotal * (taxRate / 100);
        taxLabel.innerText = `ƏDV (${taxRate}%):`;
        hiddenTaxLabel.value = `ƏDV (${taxRate}%):`;
    } else {
        taxLabel.innerText = "ƏDV-dən azad (0%):";
        hiddenTaxLabel.value = "ƏDV-dən azad (0%):";
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