import csuLogo from '../assets/images/Caraga_State_University_logo.png';

export default function UniversityBrand() {
  return (
    <>
      <span className="dashboard-university-marks" aria-hidden="true">
        <span className="dashboard-logo-csu"><img src={csuLogo} alt="" /></span>
      </span>
      <span className="super-admin-logo-text">
        <strong>Caraga State University</strong>
        <small>Cabadbaran Campus</small>
      </span>
    </>
  );
}
