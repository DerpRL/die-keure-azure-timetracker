import { useId, type ReactNode } from 'react';
import styles from './Gallery.module.css';

export function GallerySection({ id, title, description, children }: { id: string; title: string; description?: ReactNode; children: ReactNode }) {
  const headingId = useId();
  return (
    <section id={id} aria-labelledby={headingId} className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 id={headingId} className={styles.sectionTitle}>
          {title}
        </h2>
        {description ? <p className={styles.sectionDescription}>{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** One labelled specimen inside a section. */
export function Specimen({ title, children, wide = false }: { title: string; children: ReactNode; wide?: boolean }) {
  const headingId = useId();
  return (
    <div role="group" aria-labelledby={headingId} className={wide ? `${styles.specimen} ${styles.wide}` : styles.specimen}>
      <h3 id={headingId} className={styles.specimenTitle}>
        {title}
      </h3>
      <div className={styles.specimenBody}>{children}</div>
    </div>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <div className={styles.row}>{children}</div>;
}

export function Grid({ children }: { children: ReactNode }) {
  return <div className={styles.grid}>{children}</div>;
}
