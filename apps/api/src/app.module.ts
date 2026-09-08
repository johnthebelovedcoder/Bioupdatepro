import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { CoreModule } from './core.module';
import { WorkflowModule } from './workflow/workflow.module';
import { TaxModule } from './tax/tax.module';
import { MastersModule } from './masters/masters.module';
import { JournalsModule } from './journals/journals.module';
import { PayrollModule } from './payroll/payroll.module';
import { SalesModule } from './sales/sales.module';
import { ProcurementModule } from './procurement/procurement.module';
import { ClosingModule } from './closing/closing.module';
import { OperationsModule } from './operations/operations.module';
import { SearchModule } from './search/search.module';
import { PostingControlModule } from './posting-control/posting-control.module';
import { BiologicalAssetModule } from './biological-assets/biological-asset.module';
import { FixedAssetsModule } from './fixed-assets/fixed-assets.module';
import { ProductionModule } from './production/production.module';
import { InventoryModule } from './inventory/inventory.module';
import { PoultryEggModule } from './poultry-egg/poultry-egg.module';
import { RoutingModule } from './routing/routing.module';
import { FarmConfigModule } from './farm-config/farm-config.module';
import { MastersController } from './masters/masters.controller';
import { MasterDataController } from './masters/master-data.controller';
import { ProcurementController } from './procurement/procurement.controller';
import { SalesController } from './sales/sales.controller';
import { SearchController } from './search/search.controller';
import { PostingControlController } from './posting-control/posting-control.controller';
import { BiologicalAssetController } from './biological-assets/biological-asset.controller';
import { FixedAssetsController } from './fixed-assets/fixed-assets.controller';
import { ProductionOrderController } from './production/production-order.controller';
import { InventoryController } from './inventory/inventory.controller';
import { PoultryEggController } from './poultry-egg/poultry-egg.controller';
import { RoutingController } from './routing/routing.controller';
import { WorkflowController } from './workflow/workflow.controller';
import { TaxController } from './tax/tax.controller';
import { JournalsController } from './journals/journals.controller';
import { PayrollController } from './payroll/payroll.controller';
import { ClosingController } from './closing/closing.controller';
import { ReportingController } from './reporting/reporting.controller';
import { KpiService } from './reporting/kpi.service';
import { DemoController } from './demo/demo.controller';
import { PanelController } from './demo/panel.controller';

/**
 * The demo panel can reset the database and deliberately attempt tampering. It
 * exists to demonstrate that the immutability triggers hold, which means it is
 * dev scaffolding and must never be routable in production — not merely
 * protected by a role, but absent.
 */
const developmentOnlyControllers =
  process.env.NODE_ENV === 'production' ? [] : [PanelController, DemoController];

@Module({
  imports: [
    CoreModule,
    AuthModule,
    WorkflowModule,
    TaxModule,
    MastersModule,
    JournalsModule,
    PayrollModule,
    SalesModule,
    ProcurementModule,
    ClosingModule,
    OperationsModule,
    SearchModule,
    PostingControlModule,
    BiologicalAssetModule,
    FixedAssetsModule,
    ProductionModule,
    InventoryModule,
    PoultryEggModule,
    RoutingModule,
    FarmConfigModule,
  ],
  providers: [KpiService],
  controllers: [
    MastersController,
    MasterDataController,
    WorkflowController,
    TaxController,
    JournalsController,
    PayrollController,
    ClosingController,
    ReportingController,
    ProcurementController,
    SalesController,
    SearchController,
    PostingControlController,
    BiologicalAssetController,
    FixedAssetsController,
    ProductionOrderController,
    InventoryController,
    PoultryEggController,
    RoutingController,
    ...developmentOnlyControllers,
  ],
})
export class AppModule {}
