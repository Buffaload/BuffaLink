import React, { useState } from "react";
import "../css/ProfileButton.css";

interface ProfileButtonProps {
  username: string;
  handleLogout: () => void;
}

const ProfileButton: React.FC<ProfileButtonProps> = ({
  username,
  handleLogout,
}) => {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const toggleDropdown = () => {
    setIsDropdownOpen(!isDropdownOpen);
  };

  // Get the first letter of the username
  const userInitial = username ? username.charAt(0).toUpperCase() : "U";

  return (
    <div className="profile-button-container">
      <div className="profile-button" onClick={toggleDropdown}>
        <span className="profile-initial">{userInitial}</span>
      </div>
      {isDropdownOpen && (
        <div className="dropdown-menu">
          <ul>
            <li className="dropdown-item">
              <button onClick={handleLogout}>Log Out</button>
            </li>
            {/*add more options here later */}
          </ul>
        </div>
      )}
    </div>
  );
};

export default ProfileButton;
