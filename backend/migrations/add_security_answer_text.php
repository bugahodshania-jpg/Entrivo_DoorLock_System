<?php

$config = require dirname(__DIR__) . '/config/database.php';
$dsn = sprintf(
    'mysql:host=%s;port=%s;dbname=%s;charset=%s',
    $config['host'],
    $config['port'],
    $config['database'],
    $config['charset']
);

try {
    $pdo = new PDO($dsn, $config['username'], $config['password'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);

    try {
        $pdo->exec(
            "ALTER TABLE account_security_questions
             ADD COLUMN answer_text VARCHAR(100) NULL
             AFTER answer_hash"
        );
        echo "Added account_security_questions.answer_text.\n";
    } catch (PDOException $error) {
        if ($error->getCode() == '42S21') {
            echo "Column answer_text already exists.\n";
        } else {
            throw $error;
        }
    }

    $knownAnswers = [
        'What city were you born in?' => 'surigao',
        "What is your mother's maiden name?" => 'santos',
        'What is your favorite book?' => 'noli',
    ];

    $pending = $pdo->query(
        "SELECT question_id, question, answer_hash
         FROM account_security_questions
         WHERE answer_text IS NULL OR answer_text = ''"
    )->fetchAll();

    $update = $pdo->prepare(
        'UPDATE account_security_questions
         SET answer_text = :answer_text
         WHERE question_id = :question_id'
    );
    $restored = 0;

    foreach ($pending as $row) {
        $known = $knownAnswers[$row['question']] ?? null;
        if ($known === null) {
            continue;
        }

        if (!password_verify($known, (string) $row['answer_hash'])) {
            continue;
        }

        $update->execute([
            'answer_text' => $known,
            'question_id' => (int) $row['question_id'],
        ]);
        $restored++;
    }

    echo "Restored {$restored} saved answer(s) that matched known demo values.\n";
} catch (PDOException $error) {
    echo 'Migration failed: ' . $error->getMessage() . "\n";
    exit(1);
}
