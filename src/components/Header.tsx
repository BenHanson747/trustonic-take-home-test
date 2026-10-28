import { TenantSwitcher } from '../tenant/TenantSwitcher';

export function Header() {
  return (
    <header className="app-header" role="banner">
      <div className="app-header__left">
        <h1>ALPS Device Console</h1>
      </div>
      <TenantSwitcher />
    </header>
  );
}
