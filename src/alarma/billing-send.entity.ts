import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'billing_send' })
export class BillingSend {
  @PrimaryGeneratedColumn()
  id_billing_send: number;

  @Column({ nullable: true })
  sale_id: number;

  @Column({ nullable: true })
  note_id: number;

  @Column()
  document_series: string;

  @Column()
  document_number: string;

  @Column()
  document_full_number: string;

  @Column()
  status: number;

  @Column({ type: 'text', nullable: true })
  response: string;

  @Column({ nullable: true })
  attempt_count: number;

  @Column({ type: 'timestamp', nullable: true })
  last_attempt_at: Date;

  @Column({ type: 'timestamp' })
  created_at: Date;
}