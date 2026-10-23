<?php

require_once dirname(__DIR__,2) . '/services/DirectFingerprintImportService.php';
header('Content-Type: application/json');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Cache-Control: no-store');
$method=$_SERVER['REQUEST_METHOD']??'';
if($method==='OPTIONS'){http_response_code(204);exit;}

try {
    $service=new DirectFingerprintImportService();
    if($method==='GET') {
        $result=$service->claim($_GET);
    } elseif($method==='POST') {
        $input=json_decode(file_get_contents('php://input'),true,16,JSON_THROW_ON_ERROR);
        if(!is_array($input)||array_is_list($input)) throw new DirectFingerprintImportException('A valid device restore payload is required.',422);
        $result=$service->deviceUpdate($input);
    } else {
        throw new DirectFingerprintImportException('Method not allowed.',405);
    }
    echo json_encode($result);
} catch(DirectFingerprintImportException $error) {
    http_response_code($error->httpStatus);
    echo json_encode(['success'=>false,'message'=>$error->getMessage()]);
} catch(JsonException $error) {
    http_response_code(422);
    echo json_encode(['success'=>false,'message'=>'A valid JSON object is required.']);
} catch(Throwable $error) {
    error_log('Direct fingerprint device import: '.$error->getMessage());
    http_response_code(503);
    echo json_encode(['success'=>false,'message'=>'The database restore could not be confirmed. Keep the door locked and retry when the backend is available.']);
}
