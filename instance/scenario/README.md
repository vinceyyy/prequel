# Interview Scenarios

This directory contains pre-configured scenarios for different types of coding interviews. Each scenario includes files, datasets, and challenges appropriate for the interview type.

## How Scenarios Work

1. **Storage**: Scenarios are stored on AWS EFS (Elastic File System)
2. **Mounting**: When an interview starts, the selected scenario is mounted to the code-server container
3. **Isolation**: Each interview gets a copy of the scenario files in their workspace
4. **Persistence**: Candidate changes are preserved during the interview session

## Available Scenarios

### 📱 JavaScript/React (`javascript/`)
- React application with TypeScript
- Package.json with common dependencies
- Component implementation challenges
- State management tasks

### 🐍 Python/Data Science (`python/`)
- Sample datasets (CSV files)
- Data analysis challenges
- Jupyter notebook templates
- Algorithm implementation tasks

### 🗄️ SQL/Database (`sql/`)
- Pre-configured SQLite database
- Sample data (customers, orders, products)
- Complex query challenges
- Database design tasks

### 🔧 Full Stack (`fullstack/`)
- Complete React + Node.js setup
- Authentication system skeleton
- API endpoint challenges
- End-to-end feature development

## Adding New Scenarios

1. **Create directory**: `mkdir scenarios/new-scenario`
2. **Add files**: Place all necessary files, datasets, and documentation
3. **Update Terraform**: Add EFS access point in `terraform/efs.tf`
4. **Deploy**: Run `terraform apply` to create the EFS access point
5. **Upload files**: Copy scenario files to the EFS mount

## File Upload Process

After deploying the Terraform infrastructure:

1. **Mount EFS locally** (one-time setup):
   ```bash
   # Create mount directory
   sudo mkdir /mnt/efs
   
   # Mount EFS
   sudo mount -t efs -o tls fs-xxxxx.efs.region.amazonaws.com:/ /mnt/efs
   ```

2. **Copy scenario files**:
   ```bash
   # Copy each scenario to EFS
   sudo cp -r scenarios/javascript/* /mnt/efs/javascript/
   sudo cp -r scenarios/python/* /mnt/efs/python/
   sudo cp -r scenarios/sql/* /mnt/efs/sql/
   sudo cp -r scenarios/fullstack/* /mnt/efs/fullstack/
   ```

3. **Set permissions**:
   ```bash
   sudo chown -R 1000:1000 /mnt/efs/
   sudo chmod -R 755 /mnt/efs/
   ```

## Scenario Management Tips

- **Keep scenarios updated** with latest dependencies and best practices
- **Test scenarios regularly** to ensure they work in the container environment
- **Include clear instructions** in README files for candidates
- **Provide sample data** that's realistic but not too large
- **Add time estimates** for different challenges

## Customization

You can customize scenarios for specific roles:
- **Senior developers**: More complex architectural challenges
- **Junior developers**: Guided tutorials with specific steps
- **Specific technologies**: Framework-specific scenarios (Angular, Vue, Django, etc.)
- **Domain-specific**: E-commerce, fintech, healthcare scenarios