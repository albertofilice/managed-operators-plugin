import { checkErrors } from '../support';

const PLUGIN_NAME = 'managed-operators-plugin';
const PLUGIN_PULL_SPEC = Cypress.env('PLUGIN_TEMPLATE_PULL_SPEC');

export const isLocalDevEnvironment = Cypress.config('baseUrl')!.includes('localhost');

const installHelmChart = (helmBin: string) => {
  cy.exec(
    `${helmBin} upgrade -i ${PLUGIN_NAME} ../charts/openshift-console-plugin -n ${PLUGIN_NAME} --create-namespace --set plugin.image=${PLUGIN_PULL_SPEC} --set plugin.name=${PLUGIN_NAME}`,
    {
      failOnNonZeroExit: false,
    },
  ).then((result) => {
    result.stderr && cy.log('Error installing helm chart: ', result.stderr);
    result.stdout && cy.log('Successfully installed helm chart: ', result.stdout);
  });

  cy.exec(`oc rollout status -n ${PLUGIN_NAME} deploy/${PLUGIN_NAME} -w --timeout=300s`, {
    timeout: 360000,
    failOnNonZeroExit: false,
  });

  cy.exec('oc rollout status -w deploy/console -n openshift-console --timeout=300s', {
    timeout: 360000,
    failOnNonZeroExit: false,
  });

  cy.visit('/k8s/cluster/operator.openshift.io~v1~Console/cluster/console-plugins');
  cy.get(`[data-test="${PLUGIN_NAME}-status"]`).should('include.text', 'Loaded');
};

const deleteHelmChart = (helmBin: string) => {
  cy.exec(
    `${helmBin} uninstall ${PLUGIN_NAME} -n ${PLUGIN_NAME} && oc delete namespace ${PLUGIN_NAME}`,
    {
      failOnNonZeroExit: false,
    },
  ).then((result) => {
    cy.log('Error uninstalling helm chart: ', result.stderr);
    cy.log('Successfully uninstalled helm chart: ', result.stdout);
  });
};

describe('Managed operators plugin', () => {
  before(() => {
    cy.login();
    cy.get(`[data-test="tour-step-footer-secondary"]`).contains('Skip tour').click();
    if (!isLocalDevEnvironment) {
      cy.exec('cd .. && ./install_helm.sh', { failOnNonZeroExit: false }).then((result) => {
        cy.log(result.stderr);
        installHelmChart('/tmp/helm');
      });
    } else {
      installHelmChart('helm');
    }
  });

  afterEach(() => {
    checkErrors();
  });

  after(() => {
    if (!isLocalDevEnvironment) {
      deleteHelmChart('/tmp/helm');
    } else {
      deleteHelmChart('helm');
    }
    cy.logout();
  });

  it('shows the installed operators page (requires RHACM and ACM perspective)', () => {
    cy.visit('/multicloud/ecosystem/installed-operators');
    cy.get('title', { timeout: 120000 }).should('contain', 'Managed cluster operators');
  });

  it('shows the install operators page (requires RHACM and ACM perspective)', () => {
    cy.visit('/multicloud/ecosystem/install-operators');
    cy.get('title', { timeout: 120000 }).should('contain', 'Install operators');
  });
});
