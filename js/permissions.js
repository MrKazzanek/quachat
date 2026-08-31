const RoomPermissions = {
  ROLES: {
    OWNER: 'owner',
    ADMIN: 'admin',
    MEMBER: 'member'
  },

  createDefaultSettings() {
    return {
      password: null,
      requireApproval: false,
      slowMode: 0,
      allowText: true,
      allowMedia: true,
      bannedList: [],
      mutedList: [],
      adminList: []
    };
  },

  canKick(actorRole, targetRole) {
    if (actorRole === this.ROLES.OWNER) return targetRole !== this.ROLES.OWNER;
    if (actorRole === this.ROLES.ADMIN) return targetRole === this.ROLES.MEMBER;
    return false;
  },

  canBan(actorRole, targetRole) {
    return this.canKick(actorRole, targetRole);
  },

  canMute(actorRole, targetRole) {
    return this.canKick(actorRole, targetRole);
  },

  canDeleteAnyMsg(actorRole) {
    return actorRole === this.ROLES.OWNER || actorRole === this.ROLES.ADMIN;
  },

  isOwner(actorRole) {
    return actorRole === this.ROLES.OWNER;
  },

  isAdminOrOwner(actorRole) {
    return actorRole === this.ROLES.OWNER || actorRole === this.ROLES.ADMIN;
  }
};
