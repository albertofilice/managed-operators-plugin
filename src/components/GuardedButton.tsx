import * as React from 'react';
import { Button, ButtonProps, Tooltip } from '@patternfly/react-core';
import { useTranslation } from 'react-i18next';

/** A button that stays visible but inert, with an explanation, when RBAC denies the action. */
export const GuardedButton: React.FC<ButtonProps & { allowed: boolean }> = ({
  allowed,
  onClick,
  children,
  ...rest
}) => {
  const { t } = useTranslation('plugin__managed-operators-plugin');
  if (allowed) {
    return (
      <Button {...rest} onClick={onClick}>
        {children}
      </Button>
    );
  }
  return (
    <Tooltip content={t('access_denied_tooltip')}>
      <Button {...rest} isAriaDisabled>
        {children}
      </Button>
    </Tooltip>
  );
};
