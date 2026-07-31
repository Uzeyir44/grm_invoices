<?php
session_start();
if (!isset($_SESSION['user_id'])) {
    header("Location: login.php");
    exit;
}
require_once 'db.php';

$message = "";

// --- 1. Удаление ---
if (isset($_GET['delete'])) {
    $stmt = $pdo->prepare("DELETE FROM clients WHERE id = ?");
    $stmt->execute([$_GET['delete']]);
    header("Location: sirketler.php?success=deleted");
    exit;
}

// --- 2. Добавление / Изменение ---
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $id = $_POST['id'] ?? null;
    $data = [
        'client_type'         => $_POST['client_type'],
        'fullname'            => $_POST['fullname'],
        'company_name'        => $_POST['company_name'] ?? '',
        'voen'                => $_POST['voen'],
        'address'             => $_POST['address'],
        'phone'               => $_POST['phone'],
        'bank_name'           => $_POST['bank_name'],
        'branch_code'         => $_POST['branch_code'],
        'bank_voen'           => $_POST['bank_voen'],
        'm_account'           => $_POST['m_account'],
        'swift'               => $_POST['swift'],
        'beneficiary_account' => $_POST['beneficiary_account'],
        'beneficiary_voen'    => $_POST['beneficiary_voen']
    ];

    try {
        if ($id) {
            $sql = "UPDATE clients SET 
                    client_type=:client_type, fullname=:fullname, company_name=:company_name, 
                    voen=:voen, address=:address, phone=:phone, bank_name=:bank_name, 
                    branch_code=:branch_code, bank_voen=:bank_voen, m_account=:m_account, 
                    swift=:swift, beneficiary_account=:beneficiary_account, beneficiary_voen=:beneficiary_voen 
                    WHERE id=:id";
            $stmt = $pdo->prepare($sql);
            $data['id'] = $id;
            $stmt->execute($data);
            $message = "<div class='alert alert-info'>Məlumat yeniləndi!</div>";
        } else {
            $sql = "INSERT INTO clients 
                    (client_type, fullname, company_name, voen, address, phone, bank_name, branch_code, bank_voen, m_account, swift, beneficiary_account, beneficiary_voen) 
                    VALUES 
                    (:client_type, :fullname, :company_name, :voen, :address, :phone, :bank_name, :branch_code, :bank_voen, :m_account, :swift, :beneficiary_account, :beneficiary_voen)";
            $stmt = $pdo->prepare($sql);
            $stmt->execute($data);
            $message = "<div class='alert alert-success'>Yeni müştəri əlavə edildi!</div>";
        }
    } catch (PDOException $e) {
        $message = "<div class='alert alert-danger'>Xəta: " . $e->getMessage() . "</div>";
    }
}

// --- 3. Данные для редактирования ---
$edit_data = null;
if (isset($_GET['edit'])) {
    $stmt = $pdo->prepare("SELECT * FROM clients WHERE id = ?");
    $stmt->execute([$_GET['edit']]);
    $edit_data = $stmt->fetch(PDO::FETCH_ASSOC);
}

// --- 4. Список компаний ---
$clients = $pdo->query("SELECT * FROM clients ORDER BY id DESC")->fetchAll(PDO::FETCH_ASSOC);
?>

<!DOCTYPE html>
<html lang="az">
<head>
    <meta charset="UTF-8">
    <title>GRM Group - Müştəri Bazası</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.10.0/font/bootstrap-icons.css">
    <style>
        body { background-color: #c0dce3; font-family: 'Segoe UI', sans-serif; }
        .card { border: none; border-radius: 15px; box-shadow: 0 8px 20px rgba(0,0,0,0.1); }
        .btn-grm { background: #047590; color: white; transition: 0.3s; }
        .btn-grm:hover { background: #035b71; color: white; transform: translateY(-2px); }
        .section-title { font-size: 0.8rem; font-weight: bold; color: #047590; text-transform: uppercase; border-bottom: 1px solid #eee; padding-bottom: 5px; margin-top: 20px; margin-bottom: 15px; }
    </style>
</head>
<body>

<div class="container-fluid py-5 px-4">
    <div class="row g-4">
        <!-- Форма -->
        <div class="col-lg-4">
            <div class="card p-4">
                <h4 class="fw-bold mb-3" style="color: #047590;">
                    <i class="bi bi-person-plus me-2"></i><?= $edit_data ? 'Düzəliş' : 'Yeni Müştəri' ?>
                </h4>
                <button class="btn btn-grm btn-sm py-2 fw-bold"><a href="index.php" style="color: white; text-decoration: none;">Əsas səhifə</a></button>
                
                <?= $message ?>

                <form method="POST">
                    <?php if($edit_data): ?>
                        <input type="hidden" name="id" value="<?= $edit_data['id'] ?>">
                    <?php endif; ?>

                    <div class="section-title">Əsas Məlumatlar</div>
                    
                    <div class="mb-2">
                        <label class="form-label small fw-bold">Müştəri növü</label>
                        <select name="client_type" id="typeSelect" class="form-select form-select-sm" onchange="toggleForm()">
                            <option value="legal" <?= (@$edit_data['client_type'] == 'legal') ? 'selected' : '' ?>>Hüquqi Şəxs</option>
                            <option value="physical" <?= (@$edit_data['client_type'] == 'physical') ? 'selected' : '' ?>>Fiziki Şəxs</option>
                        </select>
                    </div>

                    <div id="company_field" class="mb-2">
                        <label class="form-label small fw-bold">Şirkətin adı</label>
                        <input type="text" name="company_name" class="form-control form-control-sm" value="<?= @$edit_data['company_name'] ?>"placeholder="EMPEROR GROUP MMC">
                    </div>

                    <div class="mb-2">
                        <label id="nameLabel" class="form-label small fw-bold">Direktorun S.A.A</label>
                        <input type="text" name="fullname" class="form-control form-control-sm" required value="<?= @$edit_data['fullname'] ?>"placeholder="Əliyev Əli Əli oğlu">
                    </div>

                    <div class="row g-2">
                        <div class="col-6">
                            <label class="form-label small fw-bold">VÖEN</label>
                            <input type="text" name="voen" class="form-control form-control-sm" value="<?= @$edit_data['voen'] ?>" placeholder="XXXXXXXXXX">
                        </div>
                        <div class="col-6">
                            <label class="form-label small fw-bold">Telefon</label>
                            <input type="text" name="phone" class="form-control form-control-sm" value="<?= @$edit_data['phone'] ?>" placeholder="+994XXXXXXXXX">
                        </div>
                    </div>

                    <div class="mb-2">
                        <label class="form-label small fw-bold">Ünvan</label>
                        <input type="text" name="address" class="form-control form-control-sm" value="<?= @$edit_data['address'] ?>">
                    </div>

                    <div class="section-title">Bank Rekvizitləri</div>
                    
                    <div class="mb-2">
                        <label class="form-label small fw-bold">Bankın Adı</label>
                        <input type="text" name="bank_name" class="form-control form-control-sm" value="<?= @$edit_data['bank_name'] ?>">
                    </div>

                    <div class="row g-2 mb-2">
                        <div class="col-6">
                            <label class="form-label small fw-bold">Filial Kodu</label>
                            <input type="text" name="branch_code" class="form-control form-control-sm" value="<?= @$edit_data['branch_code'] ?>">
                        </div>
                        <div class="col-6">
                            <label class="form-label small fw-bold">Bank VÖEN</label>
                            <input type="text" name="bank_voen" class="form-control form-control-sm" value="<?= @$edit_data['bank_voen'] ?>">
                        </div>
                    </div>

                    <div class="row g-2 mb-2">
                        <div class="col-6">
                            <label class="form-label small fw-bold">SWIFT</label>
                            <input type="text" name="swift" class="form-control form-control-sm" value="<?= @$edit_data['swift'] ?>">
                        </div>
                        <div class="col-6">
                            <label class="form-label small fw-bold">Müxbir Hesab</label>
                            <input type="text" name="m_account" class="form-control form-control-sm" value="<?= @$edit_data['m_account'] ?>">
                        </div>
                    </div>

                    <div class="mb-2">
                        <label class="form-label small fw-bold">Benefisiar Hesabı</label>
                        <input type="text" name="beneficiary_account" class="form-control form-control-sm" value="<?= @$edit_data['beneficiary_account'] ?>">
                    </div>

                    <div class="mb-3">
                        <label class="form-label small fw-bold">Benefisiar VÖEN</label>
                        <input type="text" name="beneficiary_voen" class="form-control form-control-sm" value="<?= @$edit_data['beneficiary_voen'] ?>">
                    </div>

                    <div class="d-grid gap-2">
                        <button type="submit" class="btn btn-grm btn-sm py-2 fw-bold"><?= $edit_data ? 'Yadda Saxla' : 'Əlavə Et' ?></button>
                        <?php if($edit_data): ?>
                            <a href="sirketler.php" class="btn btn-light btn-sm border">Ləğv et</a>
                        <?php endif; ?>
                    </div>
                </form>
            </div>
        </div>

        <!-- Таблица -->
        <div class="col-lg-8">
            <div class="card p-4">
                <h4 class="fw-bold mb-4" style="color: #047590;">Müştəri Siyahısı</h4>
                <div class="table-responsive">
                    <table class="table table-hover align-middle" style="font-size: 0.85rem;">
                        <thead class="table-light">
                            <tr>
                                <th>Ad / Şirkət / VÖEN</th>
                                <th>Bank / Hesab</th>
                                <th>Əlaqə / Ünvan</th>
                                <th class="text-end">İdarəetmə</th>
                            </tr>
                        </thead>
                        <tbody>
                            <?php foreach ($clients as $c): ?>
                            <tr>
                                <td>
                                    <div class="fw-bold"><?= $c['company_name'] ?: $c['fullname'] ?></div>
                                    <div class="text-muted small"><?= $c['fullname'] ?></div>
                                    <span class="badge bg-secondary">VÖEN: <?= $c['voen'] ?></span>
                                </td>
                                <td>
                                    <div class="small"><strong>Bank:</strong> <?= $c['bank_name'] ?></div>
                                    <div class="small text-primary"><strong>Hesab:</strong> <?= $c['beneficiary_account'] ?></div>
                                </td>
                                <td>
                                    <div class="small"><?= $c['phone'] ?></div>
                                    <div class="small text-muted italic"><?= $c['address'] ?></div>
                                </td>
                                <td class="text-end">
                                    <a href="?edit=<?= $c['id'] ?>" class="btn btn-sm btn-outline-primary"><i class="bi bi-pencil"></i></a>
                                    <a href="?delete=<?= $c['id'] ?>" class="btn btn-sm btn-outline-danger" onclick="return confirm('Silinsin?')"><i class="bi bi-trash"></i></a>
                                </td>
                            </tr>
                            <?php endforeach; ?>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    </div>
</div>

<script>
function toggleForm() {
    const type = document.getElementById('typeSelect').value;
    const compField = document.getElementById('company_field');
    const nameLabel = document.getElementById('nameLabel');

    if (type === 'physical') {
        compField.style.display = 'none';
        nameLabel.innerText = "Soyadı Adı Ata adı";
    } else {
        compField.style.display = 'block';
        nameLabel.innerText = "İcraçı direktorun S.A.A";
    }
}
toggleForm();
</script>
</body>
</html>