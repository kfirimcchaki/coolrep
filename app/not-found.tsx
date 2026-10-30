import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="notfound">
      <div>
        <h1>Page not found</h1>
        <p>The page you are looking for does not exist or has been moved.</p>
        <Link className="btn btn-primary" href="/">
          Go to homepage
        </Link>
        <p className="mono-id" style={{ marginTop: 18 }}>
          404
        </p>
      </div>
    </div>
  );
}
