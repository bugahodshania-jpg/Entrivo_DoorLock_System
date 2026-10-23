<?php

/** Cancels a request and its matching temporary access without changing regular schedules. */
final class OverrideRequestCancellationService
{
    public function __construct(private PDO $pdo)
    {
    }

    public function cancel(int $overrideId, int $userId, ?DateTimeImmutable $now = null): void
    {
        $this->pdo->beginTransaction();

        try {
            $lock = $this->pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql' ? ' FOR UPDATE' : '';
            $existing = $this->pdo->prepare(
                'SELECT override_id, approved_by, override_start, override_end
                 FROM access_overrides
                 WHERE override_id = :override_id AND user_id = :user_id
                 LIMIT 1' . $lock
            );
            $existing->execute(['override_id' => $overrideId, 'user_id' => $userId]);
            $request = $existing->fetch(PDO::FETCH_ASSOC);

            if (!$request) {
                throw new InvalidArgumentException('Override request not found.');
            }

            $now ??= new DateTimeImmutable('now');
            $end = DateTimeImmutable::createFromFormat('Y-m-d H:i:s', (string) $request['override_end']);
            if ($request['approved_by'] !== null && $end && $now > $end) {
                throw new InvalidArgumentException('Completed override requests cannot be cancelled.');
            }

            $delete = $this->pdo->prepare(
                'DELETE FROM access_overrides WHERE override_id = :override_id AND user_id = :user_id'
            );
            $delete->execute(['override_id' => $overrideId, 'user_id' => $userId]);

            if ($request['approved_by'] !== null) {
                // An identical approved request can share the same override schedule.
                $otherApproval = $this->pdo->prepare(
                    'SELECT 1 FROM access_overrides
                     WHERE user_id = :user_id AND override_start = :start AND override_end = :end
                       AND approved_by IS NOT NULL
                     LIMIT 1'
                );
                $otherApproval->execute([
                    'user_id' => $userId,
                    'start' => $request['override_start'],
                    'end' => $request['override_end'],
                ]);

                if (!$otherApproval->fetchColumn()) {
                    $cancelSchedule = $this->pdo->prepare(
                        "UPDATE schedules SET status = 'cancelled'
                         WHERE user_id = :user_id AND schedule_date = :date
                           AND time_start = :time_start AND time_end = :time_end
                           AND (schedule_kind = 'override' OR status = 'overridden')
                           AND status IN ('approved', 'overridden')"
                    );
                    $cancelSchedule->execute([
                        'user_id' => $userId,
                        'date' => substr($request['override_start'], 0, 10),
                        'time_start' => substr($request['override_start'], 11, 8),
                        'time_end' => substr($request['override_end'], 11, 8),
                    ]);
                }
            }

            $this->pdo->commit();
        } catch (Throwable $error) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            throw $error;
        }
    }
}
