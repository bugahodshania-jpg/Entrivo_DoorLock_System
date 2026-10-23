<?php

require_once dirname(__DIR__,2) . '/services/DirectFingerprintImportService.php';
header('Content-Type: application/json');
$allowedOrigins=['http://127.0.0.1:5173','http://localhost:5173'];
$origin=$_SERVER['HTTP_ORIGIN']??$allowedOrigins[0];
header('Access-Control-Allow-Origin: '.(in_array($origin,$allowedOrigins,true)?$origin:$allowedOrigins[0]));
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
header('Cache-Control: no-store');
$method=$_SERVER['REQUEST_METHOD']??'';
if($method==='OPTIONS'){http_response_code(204);exit;}

try {
    $service=new DirectFingerprintImportService();
    if($method==='GET') {
        $result=isset($_GET['job_id'])?$service->getAdminJob($_GET):$service->lookup($_GET);
    } elseif($method==='POST') {
        $input=json_decode(file_get_contents('php://input'),true,16,JSON_THROW_ON_ERROR);
        if(!is_array($input)||array_is_list($input)||!in_array($input['action']??'', ['queue','cancel'],true)) throw new DirectFingerprintImportException('Use the queue action with an employee ID and selected fingerprint backup, or cancel with a job ID.',422);
        $result=$input['action']==='cancel'?$service->cancel($input):$service->queue($input);
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
    error_log('Direct fingerprint import: '.$error->getMessage());
    http_response_code(503);
    echo json_encode(['success'=>false,'message'=>'The database restore service is unavailable. No sensor restore was confirmed. Try again when the backend is available.']);
}
